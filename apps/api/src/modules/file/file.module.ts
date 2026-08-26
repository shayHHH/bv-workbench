import { Module } from "@nestjs/common";
import { FileController } from "./file.controller";
import { StorageService } from "./storage.service";

@Module({
  controllers: [FileController],
  providers: [StorageService],
  exports: [StorageService],
})
export class FileModule {}
