import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileRef } from "@bv/shared";

/**
 * 文件存储抽象。当前实现：本地磁盘（UPLOAD_DIR，默认 apps/api/uploads）。
 * 公司对象存储（S3 兼容）接入后在此新增适配器并按 STORAGE_DRIVER 切换，
 * storage_key 语义保持不变，业务数据无需迁移字段。
 */

/** storage_key 形如 access/202608/<uuid>.pdf；白名单校验防目录穿越 */
const STORAGE_KEY_PATTERN = /^access\/\d{6}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

@Injectable()
export class StorageService {
  private readonly rootDir: string;

  constructor(config: ConfigService) {
    this.rootDir = path.resolve(config.get<string>("uploadDir") || "uploads");
  }

  async save(buffer: Buffer, originalName: string): Promise<FileRef> {
    const ext = path.extname(originalName).toLowerCase();
    const mime = EXT_MIME[ext];
    if (!mime) throw new BadRequestException("仅支持 JPG / PNG / PDF / DOC / DOCX 文件");
    const month = new Date().toISOString().slice(0, 7).replace("-", "");
    const key = `access/${month}/${randomUUID()}${ext}`;
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { storage_key: key, original_name: originalName, mime_type: mime, size: buffer.length };
  }

  async open(key: string) {
    const target = this.resolve(key);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException("文件不存在或已清理");
    const mime = EXT_MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    return { stream: createReadStream(target), mime, size: info.size };
  }

  private resolve(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new BadRequestException("非法的文件标识");
    return path.join(this.rootDir, key);
  }
}
