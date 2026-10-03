import { getPlatformBridge } from '../platform';
import { APP_VERSION } from '../core/brand';
import { ReleaseCheckService } from './ReleaseCheckService';
const bridge = getPlatformBridge();
export const defaultReleaseCheckService = new ReleaseCheckService({
  checkRelease: (etag, requestId) => bridge.checkRelease?.(etag, requestId) ?? Promise.resolve({ status: 'unsupported' }),
  cancelReleaseCheck: id => bridge.cancelReleaseCheck?.(id) ?? Promise.resolve(),
  openReleasePage: url => bridge.openReleasePage?.(url) ?? Promise.reject(new Error('Desktop host unavailable')),
  getBuildIdentity: () => bridge.getBuildIdentity?.() ?? Promise.resolve({ version: APP_VERSION, commit: 'unknown', channel: 'development', dirty: true }),
}, {
  read: () => globalThis.localStorage?.getItem('lumiseq.release-check.v1') ?? '',
  write: value => globalThis.localStorage?.setItem('lumiseq.release-check.v1', value),
});
