import { useState } from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';

function GuideBody({ platform }: { platform: string }) {
  if (platform === 'ios') {
    return (
      <ol className="install-steps">
        <li>用 <strong>Safari</strong> 打开本站（勿用微信内置浏览器）。</li>
        <li>点底部分享按钮 <strong>□↑</strong>。</li>
        <li>选择 <strong>添加到主屏幕</strong> → 添加。</li>
      </ol>
    );
  }
  if (platform === 'android') {
    return (
      <ol className="install-steps">
        <li>优先用 <strong>Chrome</strong> 打开（勿用微信/QQ 内置浏览器）。</li>
        <li>点右上角 <strong>⋮</strong> → <strong>安装应用</strong> 或 <strong>添加到主屏幕</strong>。</li>
        <li>
          若提示已安装但桌面没有图标：到系统设置里给 Chrome 开启
          <strong>「创建桌面快捷方式 / 主屏幕快捷方式」</strong>权限，等待约十几秒；也可在应用抽屉里找「车护助手」。
        </li>
        <li>
          小米 / 华为 / OPPO / vivo 等：浏览器「添加到主屏幕」往往是快捷方式（可能带浏览器角标），与系统「安装应用」(WebAPK) 不同；无 GMS 时通常无法生成完整 WebAPK。
        </li>
      </ol>
    );
  }
  return (
    <ol className="install-steps">
      <li>桌面 Chrome / Edge：地址栏右侧安装图标，或菜单 → <strong>安装车护助手</strong>。</li>
      <li>手机请用系统浏览器打开本页后再按对应系统步骤操作。</li>
    </ol>
  );
}

export function PwaInstallBanner() {
  const {
    platform,
    standalone,
    canNativePrompt,
    showInstallHint,
    installedToast,
    dismissBanner,
    dismissToast,
    promptInstall,
  } = usePwaInstall();
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      {installedToast && (
        <div className="install-toast" role="status">
          <span>已安装到本机。可从主屏幕或应用列表打开「车护助手」。</span>
          <button type="button" className="btn ghost tiny" onClick={dismissToast}>
            知道了
          </button>
        </div>
      )}

      {showInstallHint && !standalone && (
        <div className="install-banner">
          <div className="install-banner-text">
            <strong>安装到主屏幕</strong>
            <span className="muted small">离线记账更方便；部分国产机需手动「添加到主屏幕」。</span>
          </div>
          <div className="install-banner-actions">
            {canNativePrompt && (
              <button
                type="button"
                className="btn primary tiny"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await promptInstall();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                安装
              </button>
            )}
            <button type="button" className="btn tiny" onClick={() => setGuideOpen(true)}>
              怎么装
            </button>
            <button type="button" className="btn ghost tiny" onClick={dismissBanner} aria-label="关闭">
              ×
            </button>
          </div>
        </div>
      )}

      {guideOpen && (
        <div className="install-modal-backdrop" role="dialog" aria-modal="true" aria-label="安装说明">
          <div className="install-modal card">
            <header className="page-header" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>安装车护助手</h2>
              <button type="button" className="btn ghost tiny" onClick={() => setGuideOpen(false)}>
                关闭
              </button>
            </header>
            <p className="muted small">站点路径为 GitHub Pages：<code>/car-care-pwa/</code>。请用 HTTPS 系统浏览器打开。</p>
            <GuideBody platform={platform} />
            {canNativePrompt && (
              <button
                type="button"
                className="btn primary block"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await promptInstall();
                    setGuideOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                使用浏览器安装对话框
              </button>
            )}
            <p className="muted small" style={{ marginTop: 12 }}>
              详细说明见仓库 <code>docs/pwa-install.md</code>。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
