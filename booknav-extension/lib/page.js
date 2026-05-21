const PageCapture = {
  async getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url) {
      throw new Error('无法读取当前标签页');
    }
    if (!/^https?:\/\//i.test(tab.url)) {
      throw new Error('当前页面不支持添加，请切换到 http/https 页面');
    }
    return {
      title: tab.title || '',
      url: tab.url
    };
  }
};
