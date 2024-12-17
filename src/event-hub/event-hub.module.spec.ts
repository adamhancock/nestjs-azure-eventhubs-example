import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { EventHubModule, EventHubService } from './event-hub.module';
import { EventHubProducerClient, EventHubConsumerClient } from '@azure/event-hubs';

// Mock Azure Event Hubs
const mockProducerClient = {
  getPartitionIds: jest.fn().mockResolvedValue(['0', '1']),
  close: jest.fn().mockResolvedValue(undefined),
  sendBatch: jest.fn().mockResolvedValue(undefined),
};

const mockConsumerClient = {
  subscribe: jest.fn().mockResolvedValue({}),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@azure/event-hubs', () => ({
  EventHubProducerClient: jest.fn().mockImplementation(() => mockProducerClient),
  EventHubConsumerClient: jest.fn().mockImplementation(() => mockConsumerClient),
}));

describe('EventHubModule', () => {
  let module: TestingModule;
  let eventHubService: EventHubService;
  let loggerSpy: jest.SpyInstance;
  let errorLoggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Reset mocks
    mockProducerClient.getPartitionIds.mockClear();
    mockProducerClient.close.mockClear();
    mockProducerClient.sendBatch.mockClear();
    mockConsumerClient.subscribe.mockClear();
    mockConsumerClient.close.mockClear();

    // Create testing module
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [() => ({ eventHub: { connectionString: 'mock-connection-string' } })],
        }),
        EventHubModule,
      ],
      providers: [
        {
          provide: DiscoveryService,
          useValue: {
            getProviders: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: MetadataScanner,
          useValue: {
            scanFromPrototype: jest.fn(),
          },
        },
      ],
    }).compile();

    // Get service instances
    eventHubService = module.get<EventHubService>(EventHubService);

    // Setup logger spies
    loggerSpy = jest.spyOn(Logger.prototype, 'log');
    errorLoggerSpy = jest.spyOn(Logger.prototype, 'error');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
    expect(eventHubService).toBeDefined();
  });

  describe('Connection Management', () => {
    it('should get connection details from config', () => {
      const connectionDetails = (eventHubService as any).getConnectionDetails();
      expect(connectionDetails).toEqual({
        connectionString: 'mock-connection-string',
        eventHubName: undefined,
      });
    });

    it('should reuse existing producer connections', async () => {
      const producer1 = await (eventHubService as any).getProducer();
      const producer2 = await (eventHubService as any).getProducer();
      expect(producer1).toBe(producer2);
      expect(EventHubProducerClient).toHaveBeenCalledTimes(1);
    });

    it('should reuse existing consumer connections', async () => {
      const consumer1 = await (eventHubService as any).getConsumer();
      const consumer2 = await (eventHubService as any).getConsumer();
      expect(consumer1).toBe(consumer2);
      expect(EventHubConsumerClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Processing', () => {
    it('should process events with matching routing key', () => {
      const event = { properties: { routingKey: 'test.route' } };
      const result = (eventHubService as any).shouldProcessEvent(event, 'test.route');
      expect(result).toBe(true);
    });

    it('should not process events with non-matching routing key', () => {
      const event = { properties: { routingKey: 'test.route' } };
      const result = (eventHubService as any).shouldProcessEvent(event, 'different.route');
      expect(result).toBe(false);
    });

    it('should process events when no routing key is specified', () => {
      const event = { properties: { routingKey: 'test.route' } };
      const result = (eventHubService as any).shouldProcessEvent(event);
      expect(result).toBe(true);
    });
  });

  describe('Publisher Setup', () => {
    it('should wrap original method and publish result', async () => {
      const originalMethod = jest.fn().mockResolvedValue({ data: 'test' });
      const mockInstance = {
        constructor: { name: 'TestService' },
        testMethod: originalMethod,
      };
      const mockMetadata = { routingKey: 'test.route' };

      await (eventHubService as any).setupPublisher(mockInstance, 'testMethod', mockMetadata);

      // Call the wrapped method
      await mockInstance.testMethod();

      // Verify the original method was called
      expect(originalMethod).toHaveBeenCalled();

      // Verify message was published
      expect(mockProducerClient.sendBatch).toHaveBeenCalledWith([
        {
          body: { data: 'test' },
          properties: { routingKey: 'test.route' },
        },
      ]);
    });

    it('should handle partition key when specified', async () => {
      const originalMethod = jest.fn().mockResolvedValue({ data: 'test' });
      const mockInstance = {
        constructor: { name: 'TestService' },
        testMethod: originalMethod,
      };
      const mockMetadata = { routingKey: 'test.route', partitionKey: 'testPartition' };

      await (eventHubService as any).setupPublisher(mockInstance, 'testMethod', mockMetadata);
      await mockInstance.testMethod();

      expect(mockProducerClient.sendBatch).toHaveBeenCalledWith(
        [
          {
            body: { data: 'test' },
            properties: { routingKey: 'test.route' },
          },
        ],
        { partitionKey: 'testPartition' }
      );
    });
  });

  describe('Subscriber Management', () => {
    it('should group subscribers by consumer group', async () => {
      const mockSubscriber1 = {
        instance: { constructor: { name: 'Service1' } },
        methodName: 'method1',
        metadata: { consumerGroup: 'group1' },
      };
      const mockSubscriber2 = {
        instance: { constructor: { name: 'Service2' } },
        methodName: 'method2',
        metadata: { consumerGroup: 'group1' },
      };

      await (eventHubService as any).registerSubscriber(
        mockSubscriber1.instance,
        mockSubscriber1.methodName,
        mockSubscriber1.metadata
      );
      await (eventHubService as any).registerSubscriber(
        mockSubscriber2.instance,
        mockSubscriber2.methodName,
        mockSubscriber2.metadata
      );

      const subscribers = (eventHubService as any).subscribers.get('default-group1');
      expect(subscribers).toHaveLength(2);
      expect(subscribers[0].instance.constructor.name).toBe('Service1');
      expect(subscribers[1].instance.constructor.name).toBe('Service2');
    });
  });

  describe('Cleanup', () => {
    it('should close all connections on module destroy', async () => {
      // Create some connections
      await (eventHubService as any).getProducer();
      await (eventHubService as any).getConsumer();

      // Add a subscription
      const mockSubscription = { close: jest.fn().mockResolvedValue(undefined) };
      (eventHubService as any).subscriptions.set('test', mockSubscription);

      // Trigger module destroy
      await eventHubService.onModuleDestroy();

      // Verify all connections were closed
      expect(mockProducerClient.close).toHaveBeenCalled();
      expect(mockConsumerClient.close).toHaveBeenCalled();
      expect(mockSubscription.close).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle producer connection errors', async () => {
      const mockError = new Error('Connection failed');
      mockProducerClient.getPartitionIds.mockRejectedValueOnce(mockError);

      await expect((eventHubService as any).getProducer()).rejects.toThrow('Connection failed');
      expect(errorLoggerSpy).toHaveBeenCalledWith('Failed to connect to Event Hub:', mockError);
    });

    it('should handle event processing errors', async () => {
      const mockError = new Error('Processing failed');
      const mockSubscribers = [
        {
          instance: {
            constructor: { name: 'TestService' },
            testMethod: jest.fn().mockRejectedValue(mockError),
          },
          methodName: 'testMethod',
          metadata: {},
        },
      ];

      (eventHubService as any).subscribers = new Map([['default-$Default', mockSubscribers]]);

      mockConsumerClient.subscribe.mockImplementationOnce(({ processEvents }) => {
        processEvents([{ body: 'test' }], { updateCheckpoint: jest.fn() });
        return Promise.resolve({});
      });

      await (eventHubService as any).startSubscriptions();

      expect(errorLoggerSpy).toHaveBeenCalledWith(
        'Error processing event in TestService.testMethod: Error: Processing failed'
      );
    });

    it('should handle publishing errors', async () => {
      const mockError = new Error('Publishing failed');
      const originalMethod = jest.fn().mockResolvedValue({ data: 'test' });
      const mockInstance = {
        constructor: { name: 'TestService' },
        testMethod: originalMethod,
      };

      await (eventHubService as any).setupPublisher(mockInstance, 'testMethod', {});

      mockProducerClient.sendBatch.mockRejectedValueOnce(mockError);

      await expect(mockInstance.testMethod()).rejects.toThrow('Publishing failed');
      expect(errorLoggerSpy).toHaveBeenCalledWith('Error publishing message: Error: Publishing failed');
    });
  });
});
