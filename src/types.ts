// Request Types
export interface CreateUserRequest {
  name: string;
  email: string;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
}

// Response Types
export interface BaseResponse {
  message: string;
  timestamp: string;
}

export interface CreateUserResponse extends BaseResponse {
  data: CreateUserRequest;
}

export interface UpdateUserResponse extends BaseResponse {
  data: {
    userId: string;
    name?: string;
    email?: string;
  };
}

export interface MessageResponse extends BaseResponse {
  data: unknown;
}

// Event Types
export interface EventData<T = unknown> {
  routingKey: string;
  data: T;
}

// Decorator Types
export interface EventHubOptions {
  routingKey: string;
}

// Configuration Types
export interface EventHubConfig {
  connectionString: string;
}

export interface AppConfig {
  eventHub: EventHubConfig;
}

// Module Types
export interface EventHubModuleOptions {
  connectionString: string;
}
