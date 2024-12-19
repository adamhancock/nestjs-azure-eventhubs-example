import { Controller, Post, Body, Logger, HttpException, HttpStatus, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { CreateUserRequest, UpdateUserRequest, CreateUserResponse, UpdateUserResponse } from './types';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) { }

  @Post('users')
  async createUser(@Body() userData: CreateUserRequest): Promise<CreateUserResponse> {
    try {
      this.logger.log(`Received request to create user: ${JSON.stringify(userData)}`);

      if (!userData.email) {
        throw new HttpException('Email is required', HttpStatus.BAD_REQUEST);
      }

      return await this.appService.createUser(userData);
    } catch (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to create user',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('users/:id')
  async updateUser(
    @Param('id') userId: string,
    @Body() userData: UpdateUserRequest
  ): Promise<UpdateUserResponse> {
    try {
      this.logger.log(`Received request to update user ${userId}: ${JSON.stringify(userData)}`);
      return await this.appService.updateUser(userId, userData);
    } catch (error) {
      this.logger.error(`Failed to update user: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to update user',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
