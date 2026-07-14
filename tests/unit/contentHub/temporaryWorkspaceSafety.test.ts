import { describe, expect, it } from 'vitest';
import { isUnsafeTemporaryWorkspacePath } from '@/renderer/utils/workspace/workspace';

describe('temporary workspace safety', () => {
  it.each(['', '/', '/home', '/home/user', '/Users/alice', 'C:/', 'C:/Users/Alice'])(
    'rejects broad enumeration root %j',
    (workspacePath) => {
      expect(isUnsafeTemporaryWorkspacePath(workspacePath)).toBe(true);
    }
  );

  it.each(['/tmp/conversation-1', '/home/user/projects/report', 'C:/work/project'])(
    'allows a scoped temporary workspace %j',
    (workspacePath) => {
      expect(isUnsafeTemporaryWorkspacePath(workspacePath)).toBe(false);
    }
  );
});
