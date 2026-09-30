import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './profile';

const mocks = vi.hoisted(() => ({
  profileQuery: {
    data: {
      userId: 'profile-user',
      displayName: 'Saved name',
      bio: 'Saved bio',
      walletAddress: null,
      referralCode: 'invite-code',
      referralBalance: 0,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  referralQuery: {
    data: { invitedUsers: 2, referralBalance: 0, referralCode: 'invite-code' },
    isError: false,
    refetch: vi.fn(),
  },
  update: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: undefined,
  },
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetProfileQueryKey: () => ['profile'],
  getGetTestnetWalletQueryKey: () => ['testnet-wallet'],
  useGetProfile: () => mocks.profileQuery,
  useGetReferralSummary: () => mocks.referralQuery,
  useGetTestnetWallet: () => ({ data: undefined, isLoading: false, isError: false }),
  useUpdateProfile: () => mocks.update,
}));

vi.mock('@/components/identity-linking-panel', () => ({
  IdentityLinkingPanel: () => null,
}));

vi.mock('@/components/monthly-badge', () => ({
  default: () => null,
}));

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/lib/pi-app-session', () => ({
  usePiAppSession: () => ({ signedIn: false }),
}));

vi.mock('@/lib/pi-iframe-session', () => ({
  usePiIframeSession: () => ({ session: null }),
}));

vi.mock('@/lib/pi-sdk', () => ({
  isPiBrowserRuntime: () => true,
  PI_SANDBOX: false,
}));

function profileInput(field: 'displayName' | 'bio' | 'walletAddress'): HTMLInputElement {
  return screen.getByTestId(`input-profile-${field}`) as HTMLInputElement;
}

function openEditor(): void {
  fireEvent.click(screen.getByTestId('button-edit-profile'));
}

describe('profile edit controls', () => {
  beforeEach(() => {
    mocks.update.mutate.mockReset();
    mocks.update.reset.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.toast.mockReset();
  });

  afterEach(() => cleanup());

  it('opens editable fields immediately without sending a save request', () => {
    render(<ProfilePage />);

    expect(profileInput('displayName').disabled).toBe(true);
    openEditor();

    expect(profileInput('displayName').disabled).toBe(false);
    expect(profileInput('displayName').value).toBe('Saved name');
    expect(profileInput('bio').disabled).toBe(false);
    expect(profileInput('bio').value).toBe('Saved bio');
    expect(mocks.update.mutate).not.toHaveBeenCalled();
  });

  it('sends the save request only after the user presses Save changes', () => {
    render(<ProfilePage />);
    openEditor();

    fireEvent.change(profileInput('displayName'), { target: { value: 'Updated name' } });
    fireEvent.change(profileInput('bio'), { target: { value: 'Updated bio' } });
    expect(mocks.update.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-save-profile'));

    expect(mocks.update.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.update.mutate.mock.calls[0]?.[0]).toEqual({
      data: { displayName: 'Updated name', bio: 'Updated bio' },
    });
  });

  it('restores the saved values and closes editing when Cancel is pressed', () => {
    render(<ProfilePage />);
    openEditor();

    fireEvent.change(profileInput('displayName'), { target: { value: 'Unsaved name' } });
    fireEvent.change(profileInput('bio'), { target: { value: 'Unsaved bio' } });
    fireEvent.click(screen.getByTestId('button-cancel-profile-edit'));

    expect(profileInput('displayName').value).toBe('Saved name');
    expect(profileInput('bio').value).toBe('Saved bio');
    expect(profileInput('displayName').disabled).toBe(true);
    expect(profileInput('bio').disabled).toBe(true);
    expect(mocks.update.mutate).not.toHaveBeenCalled();
  });
});