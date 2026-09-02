import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { COMPLIANCE_DUTY_ROLES, UPLOAD_MAX_SIZE } from "@bv/shared";
import type { Response } from "express";
import { Roles } from "../../auth/decorators";
import { StorageService } from "./storage.service";

@Controller("files")
export class FileController {
  constructor(private readonly storageService: StorageService) {}

  /** 上传单个材料文件，返回 FileRef；随草稿保存挂到申请上 */
  @Post()
  @Roles("AGENT", "OPS", "MANAGER", "FINANCE", "WALLET", "PAYOUT", ...COMPLIANCE_DUTY_ROLES, "ADMIN")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: UPLOAD_MAX_SIZE } }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("未收到文件");
    // 浏览器传中文文件名为 latin1，转回 utf8
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
    return this.storageService.save(file.buffer, originalName);
  }

  /** 鉴权预览/下载：GET /api/files?key=...&name=...&download=1（登录即可，客户抽屉材料预览全员可看） */
  @Get()
  async serve(
    @Res() res: Response,
    @Query("key") key?: string,
    @Query("name") name?: string,
    @Query("download") download?: string,
  ) {
    if (!key) throw new BadRequestException("缺少文件标识");
    const { stream, mime, size } = await this.storageService.open(key);
    const disposition = download ? "attachment" : "inline";
    const filename = encodeURIComponent(name || key.split("/").pop() || "file");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", size);
    res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${filename}`);
    stream.pipe(res);
  }
}
