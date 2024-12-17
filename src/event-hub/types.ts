export interface BaseEventData {
  message: string;
  timestamp: string;
  [key: string]: any;
}

export interface EventData extends BaseEventData {
  data?: any;
}

export interface UserEventData extends BaseEventData {
  data: {
    userId?: string;
    [key: string]: any;
  };
}

export type EventType = 'user.created' | 'user.updated' | 'message';

export interface CreateUserResponse extends UserEventData { }
export interface UpdateUserResponse extends UserEventData { }
export interface MessageResponse extends EventData { }
