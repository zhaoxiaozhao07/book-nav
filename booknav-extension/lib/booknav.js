const BookNavClient = {
  normalizeBaseUrl(baseUrl) {
    return (baseUrl || '').trim().replace(/\/+$/, '');
  },

  async request(path, options = {}) {
    const config = await Storage.getBookNavConfig();
    const baseUrl = this.normalizeBaseUrl(config.baseUrl);
    const token = (config.token || '').trim();
    if (!baseUrl || !token) {
      throw new Error('请先在设置页填写 BookNav 地址和 API Token');
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.headers || {})
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(`BookNav 返回了非 JSON 响应 (${response.status})`);
      }
    }

    if (!response.ok || data.success === false) {
      const message = data.message || response.statusText || '请求失败';
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  },

  async testConnection() {
    const data = await this.request('/api/extension/me');
    await Storage.saveBookNavConfig({ user: data.user || null });
    return data.user;
  },

  async fetchCategories() {
    const data = await this.request('/api/extension/categories');
    const categories = data.categories || [];
    await Storage.saveBookNavConfig({
      categories,
      lastSyncAt: new Date().toISOString()
    });
    return categories;
  },

  async checkUrl(url) {
    const query = encodeURIComponent(url || '');
    return this.request(`/api/extension/check-url?url=${query}`);
  },

  async createBookmark(payload) {
    return this.request('/api/extension/bookmarks', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
};
