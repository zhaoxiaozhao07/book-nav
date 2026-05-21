chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'booknav-add-current-page',
    title: '添加书签',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'booknav-add-current-page' || !tab?.url) return;
  await chrome.storage.local.set({
    pendingPage: {
      title: tab.title || '',
      url: tab.url,
      createdAt: Date.now()
    }
  });
  chrome.action.openPopup().catch(() => undefined);
});
