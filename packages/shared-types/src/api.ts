export interface ApiResponse<T> {
  data: T;
  error: null;
}

export interface ApiError {
  data: null;
  error: {
    message: string;
    code?: string;
    status?: number;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface TokenVerifyResponse {
  valid: boolean;
  userId: string;
  tenantId: string;
  role: string;
  expiresAt: number;
}

export interface AuthMeResponse {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
}
