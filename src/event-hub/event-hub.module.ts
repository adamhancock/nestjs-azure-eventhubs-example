import { Module, OnModuleDestroy, Injectable, Logger } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  EventHubConsumerClient,
  EventHubProducerClient,
  SubscribeOptions,
  ReceivedEventData,
  EventData,
  Subscription
} from '@azure/event-hubs';
import { EVENT_HUB_PUBLISH, EVENT_HUB_SUBSCRIBE, EventHubMetadata } from './decorators';

interface SubscriberInfo {
  instance: any;
  methodName: string;
  metadata: EventHubMetadata;
}

@Injectable()
export class EventHubService implements OnModuleDestroy {
  private readonly logger = new Logger(EventHubService.name);
  private producers: Map<string, EventHubProducerClient> = new Map();
  private consumers: Map<string, EventHubConsumerClient> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private subscribers: Map<string, SubscriberInfo[]> = new Map();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly configService: ConfigService,
  ) { }

  async onModuleDestroy() {
    // Close all subscriptions
    for (const subscription of this.subscriptions.values()) {
      await subscription.close();
    }
    // Close all producers
    for (const producer of this.producers.values()) {
      await producer.close();
    }
    // Close all consumers
    for (const consumer of this.consumers.values()) {
      await consumer.close();
    }
  }

  async onApplicationBootstrap() {
    await this.initialize();
  }

  async initialize() {
    await this.setupEventHandlers();
    await this.startSubscriptions();
  }

  private getConnectionDetails(metadata?: EventHubMetadata) {
    const connectionString = this.configService.get<string>('eventHub.connectionString');
    const eventHubName = metadata?.eventHubName;
    return { connectionString, eventHubName };
  }

  private async getProducer(metadata?: EventHubMetadata): Promise<EventHubProducerClient> {
    const { connectionString, eventHubName } = this.getConnectionDetails(metadata);
    const key = `${eventHubName || 'default'}`;

    if (!this.producers.has(key)) {
      const producer = new EventHubProducerClient(connectionString, eventHubName);
      this.producers.set(key, producer);

      try {
        const partitionIds = await producer.getPartitionIds();
        this.logger.log(`Successfully connected to Event Hub ${eventHubName || '(default)'}. Partition IDs: ${partitionIds}`);
      } catch (error) {
        this.logger.error('Failed to connect to Event Hub:', error);
        throw error;
      }
    }
    return this.producers.get(key);
  }

  private async getConsumer(metadata?: EventHubMetadata): Promise<EventHubConsumerClient> {
    const { connectionString, eventHubName } = this.getConnectionDetails(metadata);
    const consumerGroup = metadata?.consumerGroup || '$Default';
    const key = `${eventHubName || 'default'}-${consumerGroup}`;

    if (!this.consumers.has(key)) {
      const consumer = new EventHubConsumerClient(consumerGroup, connectionString, eventHubName);
      this.consumers.set(key, consumer);
    }
    return this.consumers.get(key);
  }

  private async setupEventHandlers() {
    const providers = this.discovery.getProviders()
      .filter(wrapper => wrapper.instance);

    for (const wrapper of providers) {
      const { instance } = wrapper;
      const prototype = Object.getPrototypeOf(instance);

      this.metadataScanner.scanFromPrototype(
        instance,
        prototype,
        async (methodName: string) => {
          const methodRef = prototype[methodName];
          const subscribeMetadata = Reflect.getMetadata(EVENT_HUB_SUBSCRIBE, methodRef);
          const publishMetadata = Reflect.getMetadata(EVENT_HUB_PUBLISH, methodRef);

          if (subscribeMetadata) {
            await this.registerSubscriber(instance, methodName, subscribeMetadata);
          }

          if (publishMetadata) {
            await this.setupPublisher(instance, methodName, publishMetadata);
          }
        },
      );
    }
  }

  private async registerSubscriber(instance: any, methodName: string, metadata: EventHubMetadata) {
    const key = `${metadata.eventHubName || 'default'}-${metadata.consumerGroup || '$Default'}`;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, []);
    }

    this.subscribers.get(key).push({ instance, methodName, metadata });
    this.logger.log(`Registered subscriber ${instance.constructor.name}.${methodName} ${metadata.routingKey ? `for routing key ${metadata.routingKey}` : ''}`);
  }

  private async startSubscriptions() {
    for (const [key, subscribers] of this.subscribers.entries()) {
      if (subscribers.length === 0) continue;

      const consumer = await this.getConsumer(subscribers[0].metadata);
      const subscription = await consumer.subscribe({
        processEvents: async (events, context) => {
          for (const event of events) {
            for (const { instance, methodName, metadata } of subscribers) {
              if (this.shouldProcessEvent(event, metadata.routingKey)) {
                try {
                  await instance[methodName](event.body);
                } catch (error) {
                  this.logger.error(`Error processing event in ${instance.constructor.name}.${methodName}: ${error}`);
                }
              }
            }
            await context.updateCheckpoint(event);
          }
        },
        processError: async (err, context) => {
          this.logger.error(`Error from Event Hub: ${err}`);
        }
      });

      this.subscriptions.set(key, subscription);
      this.logger.log(`Started subscription for consumer group ${key} with ${subscribers.length} subscriber(s)`);
    }
  }

  private shouldProcessEvent(event: ReceivedEventData, routingKey?: string): boolean {
    if (!routingKey) return true;
    const eventRoutingKey = event.properties?.routingKey;
    return eventRoutingKey === routingKey;
  }

  private async setupPublisher(instance: any, methodName: string, metadata: EventHubMetadata) {
    const originalMethod = instance[methodName];
    const self = this;

    instance[methodName] = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      try {
        const producer = await self.getProducer(metadata);
        const eventData: EventData = {
          body: result,
          properties: metadata.routingKey ? { routingKey: metadata.routingKey } : undefined
        };

        if (metadata.partitionKey) {
          await producer.sendBatch([eventData], { partitionKey: metadata.partitionKey });
        } else {
          await producer.sendBatch([eventData]);
        }

        self.logger.log(`Successfully published message from ${instance.constructor.name}.${methodName} ${metadata.routingKey ? `with routing key ${metadata.routingKey}` : ''}`);
      } catch (error) {
        self.logger.error(`Error publishing message: ${error}`);
        throw error;
      }

      return result;
    };

    this.logger.log(`Publisher setup complete for ${instance.constructor.name}.${methodName} ${metadata.routingKey ? `with routing key ${metadata.routingKey}` : ''}`);
  }
}

@Module({
  imports: [DiscoveryModule, ConfigModule],
  providers: [EventHubService, MetadataScanner],
  exports: [EventHubService],
})
export class EventHubModule { }
