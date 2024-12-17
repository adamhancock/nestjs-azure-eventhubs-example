import 'reflect-metadata';

export const EVENT_HUB_PUBLISH = Symbol('event_hub_publish');
export const EVENT_HUB_SUBSCRIBE = Symbol('event_hub_subscribe');

export interface EventHubOptions {
  eventHubName?: string;  // Optional if using connection string with EntityPath
  routingKey?: string;    // For message routing
  consumerGroup?: string; // For subscribers
  partitionKey?: string;  // For publishers
}

export interface EventHubMetadata extends EventHubOptions {
  methodName: string;
  target: any;
}

export const EventHub = (options: EventHubOptions = {}): MethodDecorator => {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: EventHubMetadata = {
      ...options,
      methodName: propertyKey.toString(),
      target
    };
    Reflect.defineMetadata(EVENT_HUB_PUBLISH, metadata, descriptor.value);
    return descriptor;
  };
};

export const EventHubPublish = (options: EventHubOptions = {}): MethodDecorator => {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: EventHubMetadata = {
      ...options,
      methodName: propertyKey.toString(),
      target
    };
    Reflect.defineMetadata(EVENT_HUB_PUBLISH, metadata, descriptor.value);
    return descriptor;
  };
};

export const EventHubSubscribe = (options: EventHubOptions = {}): MethodDecorator => {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: EventHubMetadata = {
      ...options,
      methodName: propertyKey.toString(),
      target
    };
    Reflect.defineMetadata(EVENT_HUB_SUBSCRIBE, metadata, descriptor.value);
    return descriptor;
  };
};
