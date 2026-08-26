/** 分页请求参数（page 从 1 开始） */
export interface PageQuery {
  page?: number;
  page_size?: number;
}

/** 分页响应包 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
