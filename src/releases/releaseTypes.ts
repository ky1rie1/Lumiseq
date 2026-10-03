export interface BuildIdentity { version: string; commit: string; channel: 'stable' | 'development'; dirty: boolean }
export interface ReleaseAsset { name: string; url: string }
export interface ApplicableRelease {
  version: string; tag: string; url: string; publishedAt: string; notes: string;
  installer?: ReleaseAsset; portable?: ReleaseAsset;
}
export interface ReleaseQueryResult {
  status: 'ok' | 'notModified' | 'offline' | 'timeout' | 'rateLimited' | 'notFound' | 'error' | 'malformed' | 'tooLarge' | 'cancelled' | 'unsupported';
  releases?: unknown[]; etag?: string; hasNextPage?: boolean; retryAt?: number;
}
export interface ReleasePlatform {
  checkRelease(etag?: string, requestId?: string): Promise<ReleaseQueryResult>;
  cancelReleaseCheck?(requestId: string): Promise<void>;
  openReleasePage(url: string): Promise<void>;
  getBuildIdentity(): Promise<BuildIdentity>;
}
