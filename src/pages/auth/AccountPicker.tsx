import { SavedAccount, createDefaultAvatarDataUrl, removeSavedAccount } from "../../hooks/useSavedAccounts";
import { useAuth } from "../../hooks/useAuth";

interface AccountPickerProps {
  accounts: SavedAccount[];
  onSelectAccount: () => void;
  onRegister: () => void;
  onAddAccount: () => void;
}

export function AccountPicker({
  accounts,
  onRegister,
  onAddAccount,
}: AccountPickerProps) {
  const { signIn, loading } = useAuth();

  return (
    <div className="auth-card auth-picker-card">
      <div className="auth-header">
        <h1 className="auth-title">CHỌN TÀI KHOẢN</h1>
        <p className="auth-subtitle">Tài khoản đã lưu trên thiết bị này</p>
      </div>
      <div className="account-picker-grid">
        {accounts.map((account) => (
          <div key={account.email} className="account-picker-tile">
            <button
              type="button"
              className="account-picker-item"
              disabled={loading}
              onClick={() => signIn(account.email, account.password, true)}
            >
              <div className="account-picker-box">
                <img
                  className="account-picker-avatar"
                  src={account.avatarUrl || createDefaultAvatarDataUrl(account.displayName || account.email)}
                  alt={account.displayName}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = createDefaultAvatarDataUrl(
                      account.displayName || account.email
                    );
                  }}
                />
              </div>
              <div className="account-picker-name">
                {account.displayName || account.username || account.email}
              </div>
              <div className="account-picker-username">
                {account.username || account.email}
              </div>
            </button>
            <button
              type="button"
              className="account-picker-delete"
              title="Xóa tài khoản đã lưu"
              onClick={(e) => {
                e.stopPropagation();
                removeSavedAccount(account.email);
                window.location.reload();
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="account-picker-tile">
          <button
            type="button"
            className="account-picker-item account-picker-item--add"
            onClick={onAddAccount}
          >
            <div className="account-picker-box account-picker-plus">+</div>
            <div className="account-picker-name">&nbsp;</div>
            <div className="account-picker-username">&nbsp;</div>
          </button>
        </div>
      </div>
      <div className="account-picker-actions">
        <p className="account-picker-inline-cta">
          Chưa có tài khoản?{" "}
          <button type="button" className="account-picker-inline-link" onClick={onRegister}>
            đăng ký miễn phí ngay
          </button>
        </p>
      </div>
    </div>
  );
}
