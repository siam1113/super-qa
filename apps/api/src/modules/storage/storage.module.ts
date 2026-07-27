import { Module, Global } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max file size
      },
    }),
  ],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
