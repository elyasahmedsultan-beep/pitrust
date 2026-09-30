import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './profile';

const mocks = vi.hoisted(() => ({
  profile: {
    userId: 'user-1',
    displayName: 'Saved name',
    bio: 'Saved bio',
    walletAddress: null,
    referralCode: 'REF123',
    referralBalance: 0,
  },
  getProfile: vi.fn(),
  profileQueryOptions: vi.fn(),
  profileIsError: false,
  update: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown,
  },
  toast: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetProfileQueryKey: () => ['profile'],
  getGetTestnetWalletQueryKey: () => ['testnet-wallet'],
  useGetProfile: (options?: unknown) => {
    mocks.profileQueryOptions(options);
    return {
      data: mocks.getProfile(),
      isLoading: false,
      isError: mocks.profileIsError,
      refetch: vi.fn(),
    };
  },
  useGetReferralSummary: () => ({
    data: { invitedUsers: 0, referralBalance: 0 },
    isError: false,
    refetch: vi.fn(),
  }),
  useGetTestnetWallet: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useUpdateProfile: () => mocks.update,
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
  isPiBrowserRuntime: () => false,
  PI_SANDBOX: false,
}));

vi.mock('@/components/identity-linking-panel', () => ({
  IdentityLinkingPanel: () => null,
}));

vi.mock('@/components/monthly-badge', () => ({
  default: () => null,
}));

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>
  );
  const rendered = render(tree());
  return {
    ...rendered,
    rerenderProfile: () => rendered.rerender(tree()),
  };
}

describe('profile editing', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = {
      userId: 'user-1',
      displayName: 'Saved name',
      bio: 'Saved bio',
      walletAddress: null,
      referralCode: 'REF123',
      referralBalance: 0,
    };
    mocks.update.isError = false;
    mocks.update.error = null;
    mocks.profileIsError = false;
    mocks.profileQueryOptions.mockClear();
    mocks.getProfile.mockImplementation(() => mocks.profile);
  });

  it('enables editing immediately and only sends changes after save is pressed', () => {
    renderProfile();

    fireEvent.click(screen.getByTestId('button-edit-profile'));

    const displayName = screen.getByTestId(
      'input-profile-displayName',
    ) as HTMLInputElement;
    const bio = screen.getByTestId('input-profile-bio') as HTMLInputElement;
    expect(displayName.disabled).toBe(false);
    expect(bio.disabled).toBe(false);
    expect(mocks.update.mutate).not.toHaveBeenCalled();

    fireEvent.change(displayName, { target: { value: 'Updated name' } });
    fireEvent.change(bio, { target: { value: 'Updated bio' } });
    expect(mocks.update.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-save-profile'));

    expect(mocks.update.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.update.mutate).toHaveBeenCalledWith(
      { data: { displayName: 'Updated name', bio: 'Updated bio' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('pauses automatic profile fetches and keeps the draft open when server data changes', () => {
    const view = renderProfile();

    fireEvent.click(screen.getByTestId('button-edit-profile'));
    fireEvent.change(screen.getByTestId('input-profile-displayName'), {
      target: { value: 'Draft name' },
    });
    fireEvent.change(screen.getByTestId('input-profile-bio'), {
      target: { value: 'Draft bio' },
    });

    expect(mocks.profileQueryOptions).toHaveBeenLastCalledWith({
      query: expect.objectContaining({
        enabled: false,
        refetchInterval: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      }),
    });

    mocks.profile = {
      ...mocks.profile,
      displayName: 'Server name',
      bio: 'Server bio',
    };
    mocks.profileIsError = true;
    view.rerenderProfile();

    expect(screen.getByTestId('input-profile-displayName')).toHaveProperty(
      'value',
      'Draft name',
    );
    expect(screen.getByTestId('input-profile-bio')).toHaveProperty(
      'value',
      'Draft bio',
    );
    expect(
      (screen.getByTestId('input-profile-displayName') as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByTestId('button-save-profile')).toBeTruthy();
    expect(mocks.update.mutate).not.toHaveBeenCalled();
  });

  it('does not save on implicit form submission', () => {
    renderProfile();

    fireEvent.click(screen.getByTestId('button-edit-profile'));
    fireEvent.change(screen.getByTestId('input-profile-displayName'), {
      target: { value: 'Draft name' },
    });
    fireEvent.submit(screen.getByTestId('form-profile'));

    expect(mocks.update.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('input-profile-displayName')).toHaveProperty(
      'value',
      'Draft name',
    );
  });

  it('restores saved values on cancel without sending an update', () => {
    renderProfile();

    fireEvent.click(screen.getByTestId('button-edit-profile'));
    const displayName = screen.getByTestId(
      'input-profile-displayName',
    ) as HTMLInputElement;
    const bio = screen.getByTestId('input-profile-bio') as HTMLInputElement;
    const wallet = screen.getByTestId(
      'input-profile-walletAddress',
    ) as HTMLInputElement;

    fireEvent.change(displayName, { target: { value: 'Unsaved name' } });
    fireEvent.change(bio, { target: { value: 'Unsaved bio' } });
    fireEvent.change(wallet, { target: { value: 'Unsaved wallet' } });
    fireEvent.click(screen.getByTestId('button-cancel-profile-edit'));

    expect(displayName.value).toBe('Saved name');
    expect(bio.value).toBe('Saved bio');
    expect(wallet.value).toBe('');
    expect(displayName.disabled).toBe(true);
    expect(bio.disabled).toBe(true);
    expect(wallet.disabled).toBe(true);
    expect(mocks.update.mutate).not.toHaveBeenCalled();
  });

  it('shows a save error and keeps unsaved profile values in edit mode', () => {
    const view = renderProfile();

    fireEvent.click(screen.getByTestId('button-edit-profile'));
    fireEvent.change(screen.getByTestId('input-profile-displayName'), {
      target: { value: 'Unsaved name' },
    });
    fireEvent.change(screen.getByTestId('input-profile-bio'), {
      target: { value: 'Unsaved bio' },
    });

    mocks.update.mutate.mockImplementation(() => {
      mocks.update.isError = true;
      mocks.update.error = new Error('Request failed');
    });
    fireEvent.click(screen.getByTestId('button-save-profile'));
    view.rerenderProfile();

    expect(mocks.update.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('errors.saveChanges');
    expect(
      (screen.getByTestId('input-profile-displayName') as HTMLInputElement)
        .value,
    ).toBe('Unsaved name');
    expect(
      (screen.getByTestId('input-profile-bio') as HTMLInputElement).value,
    ).toBe('Unsaved bio');
    expect(
      (screen.getByTestId('input-profile-displayName') as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByTestId('button-cancel-profile-edit')).toBeTruthy();
    expect(screen.queryByText('profile.savedSuccess')).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows the saved name and bio after reloading the profile from the server', () => {
    mocks.update.mutate.mockImplementation((request, callbacks) => {
      mocks.profile = { ...mocks.profile, ...request.data };
      callbacks.onSuccess(mocks.profile);
    });

    const firstPage = renderProfile();
    fireEvent.click(screen.getByTestId('button-edit-profile'));
    fireEvent.change(screen.getByTestId('input-profile-displayName'), {
      target: { value: 'Updated name' },
    });
    fireEvent.change(screen.getByTestId('input-profile-bio'), {
      target: { value: 'Updated bio' },
    });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    expect(mocks.update.mutate).toHaveBeenCalledWith(
      { data: { displayName: 'Updated name', bio: 'Updated bio' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mocks.profile.displayName).toBe('Updated name');
    expect(mocks.profile.bio).toBe('Updated bio');

    firstPage.unmount();
    renderProfile();

    expect(mocks.getProfile).toHaveBeenCalled();
    expect(
      (screen.getByTestId('input-profile-displayName') as HTMLInputElement).value,
    ).toBe('Updated name');
    expect(
      (screen.getByTestId('input-profile-bio') as HTMLInputElement).value,
    ).toBe('Updated bio');
  });
});