import { Injectable, Logger } from '@nestjs/common';
import { EventHubPublish, EventHubSubscribe } from './event-hub/decorators';
import { CreateUserResponse, UpdateUserResponse, MessageResponse, EventData } from './event-hub/types';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  @EventHubPublish({ routingKey: 'user.created' })
  async createUser(userData: any): Promise<CreateUserResponse> {
    this.logger.log(`Creating user: ${JSON.stringify(userData)}`);
    return {
      message: 'User created',
      timestamp: new Date().toISOString(),
      data: userData
    };
  }

  @EventHubPublish({ routingKey: 'user.updated' })
  async updateUser(userId: string, userData: any): Promise<UpdateUserResponse> {
    this.logger.log(`Updating user ${userId}: ${JSON.stringify(userData)}`);
    return {
      message: 'User updated',
      timestamp: new Date().toISOString(),
      data: { userId, ...userData }
    };
  }

  @EventHubSubscribe({ routingKey: 'user.created' })
  async handleUserCreated(data: CreateUserResponse) {
    this.logger.log(`New user created: ${JSON.stringify(data)}`);
  }

  @EventHubSubscribe({ routingKey: 'user.updated' })
  async handleUserUpdated(data: UpdateUserResponse) {
    this.logger.log(`User updated: ${JSON.stringify(data)}`);
  }

}
