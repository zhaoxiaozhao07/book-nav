const Storage = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },

  async set(data) {
    return chrome.storage.local.set(data);
  },

  async remove(keys) {
    return chrome.storage.local.remove(keys);
  },

  async getBookNavConfig() {
    const { booknav = {} } = await this.get('booknav');
    return {
      baseUrl: '',
      token: '',
      user: null,
      categories: [],
      lastSyncAt: '',
      ...booknav
    };
  },

  async saveBookNavConfig(config) {
    const current = await this.getBookNavConfig();
    await this.set({ booknav: { ...current, ...config } });
  },

  async clearBookNavToken() {
    const current = await this.getBookNavConfig();
    await this.set({ booknav: { ...current, token: '', user: null, categories: [], lastSyncAt: '' } });
  },

  async getProviders() {
    const { providers = [] } = await this.get('providers');
    return providers;
  },

  async saveProviders(providers) {
    await this.set({ providers });
  },

  async getActiveProvider() {
    const { activeProviderId } = await this.get('activeProviderId');
    if (!activeProviderId) return null;
    const providers = await this.getProviders();
    return providers.find((provider) => provider.id === activeProviderId) || null;
  },

  async setActiveProvider(id) {
    await this.set({ activeProviderId: id });
  },

  async getModels() {
    const { models = [] } = await this.get('models');
    return models;
  },

  async saveModels(models) {
    await this.set({ models });
  },

  async getActiveModel() {
    const { activeModelId } = await this.get('activeModelId');
    if (!activeModelId) return null;
    const models = await this.getModels();
    return models.find((model) => model.id === activeModelId) || null;
  },

  async setActiveModel(id) {
    await this.set({ activeModelId: id });
  },

  async getPromptTemplates() {
    const { promptTemplates } = await this.get('promptTemplates');
    return promptTemplates || {
      classify: DEFAULT_CLASSIFY_PROMPT
    };
  },

  async savePromptTemplates(templates) {
    await this.set({ promptTemplates: templates });
  },

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
};

const DEFAULT_CLASSIFY_PROMPT = `你是书签分类和描述助手。请根据当前页面信息，从已有分类中推荐最匹配的一项，并生成适合保存到导航站的链接描述。

当前页面信息：
- 标题：{title}
- URL：{url}
- 描述：{description}

已有分类：
{categories}

严格要求：
1. 只能推荐“已有分类”列表中的分类，禁止新增分类。
2. 必须返回已有分类的 id，不能返回名称相似但不存在的分类。
3. 如果多个分类都合适，选择最具体的一项。
4. description 用简洁中文概括链接用途或内容，不超过 200 字。
5. 如果标题、URL 和已有描述都无法判断出有效信息，description 必须返回空字符串。

请以 JSON 返回：
{
  "category_id": 1,
  "description": "不超过200字的链接描述；没有有效信息时返回空字符串",
  "reason": "推荐理由，不超过40字"
}`;
