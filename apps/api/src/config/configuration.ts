export default () => ({
  port: Number(process.env.PORT || 3000),
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bv_workbench",
  /** JWT 签名密钥；生产环境必须通过环境变量提供强随机值 */
  jwtSecret: process.env.JWT_SECRET || "bv-workbench-dev-secret-change-me",
  /**
   * 内部数据仓库（预留）。留空表示未接入。
   * 接入前需与 DBA 确认：独立最小权限账号、出口 IP 白名单、TLS 要求。
   */
  internalDwUri: process.env.INTERNAL_DW_MONGODB_URI || "",
  /**
   * 材料文件存储目录（本地磁盘适配器）。相对路径基于 API 进程工作目录（apps/api）。
   * 公司对象存储信息确认后切换 S3 兼容适配器，见 modules/file/storage.service.ts。
   */
  uploadDir: process.env.UPLOAD_DIR || "uploads",
});
