const optionEls = {
  baseUrl: document.getElementById('baseUrlInput'),
  token: document.getElementById('tokenInput'),
  pairStatus: document.getElementById('pairStatus'),
  saveBooknav: document.getElementById('saveBooknavBtn'),
  syncCategories: document.getElementById('syncCategoriesBtn'),
  clearToken: document.getElementById('clearTokenBtn'),
  booknavInfo: document.getElementById('booknavInfo'),
  providerName: document.getElementById('providerNameInput'),
  providerBaseUrl: document.getElementById('providerBaseUrlInput'),
  providerApiKey: document.getElementById('providerApiKeyInput'),
  saveProvider: document.getElementById('saveProviderBtn'),
  fetchModels: document.getElementById('fetchModelsBtn'),
  aiStatus: document.getElementById('aiStatus'),
  modelSelect: document.getElementById('modelSelect'),
  manualModel: document.getElementById('manualModelInput'),
  addModel: document.getElementById('addModelBtn'),
  testModel: document.getElementById('testModelBtn'),
  prompt: document.getElementById('promptInput'),
  savePrompt: document.getElementById('savePromptBtn'),
  resetPrompt: document.getElementById('resetPromptBtn'),
  toast: document.getElementById('toast')
};

document.addEventListener('DOMContentLoaded', initOptions);

async function initOptions() {
  bindOptionEvents();
  await loadBookNavConfig();
  await loadProviderConfig();
  await loadPromptConfig();
}

function bindOptionEvents() {
  optionEls.saveBooknav.addEventListener('click', saveAndTestBookNav);
  optionEls.syncCategories.addEventListener('click', syncCategories);
  optionEls.clearToken.addEventListener('click', clearBookNavToken);
  optionEls.saveProvider.addEventListener('click', saveProvider);
  optionEls.fetchModels.addEventListener('click', fetchModels);
  optionEls.addModel.addEventListener('click', addManualModel);
  optionEls.testModel.addEventListener('click', testCurrentModel);
  optionEls.modelSelect.addEventListener('change', () => Storage.setActiveModel(optionEls.modelSelect.value));
  optionEls.savePrompt.addEventListener('click', savePrompt);
  optionEls.resetPrompt.addEventListener('click', resetPrompt);
}

async function loadBookNavConfig() {
  const config = await Storage.getBookNavConfig();
  optionEls.baseUrl.value = config.baseUrl || '';
  optionEls.token.value = config.token || '';
  updatePairStatus(config.user, config.categories || [], config.lastSyncAt);
}

function updatePairStatus(user, categories, lastSyncAt) {
  if (user) {
    optionEls.pairStatus.textContent = `已连接：${user.username}`;
    optionEls.pairStatus.className = 'badge success';
  } else {
    optionEls.pairStatus.textContent = '未连接';
    optionEls.pairStatus.className = 'badge warning';
  }

  const categoryText = categories?.length ? `已同步 ${categories.length} 个分类` : '尚未同步分类';
  const syncText = lastSyncAt ? `，最后同步 ${new Date(lastSyncAt).toLocaleString()}` : '';
  optionEls.booknavInfo.textContent = user
    ? `当前配对用户：${user.username}。${categoryText}${syncText}。`
    : '请在后台“Chrome 插件”页面生成当前用户的 API Token。';
}

async function saveAndTestBookNav() {
  const baseUrl = optionEls.baseUrl.value.trim().replace(/\/+$/, '');
  const token = optionEls.token.value.trim();
  if (!baseUrl || !token) {
    showToast('请填写服务地址和 API Token', 'error');
    return;
  }

  setBusy(optionEls.saveBooknav, true, '测试中...');
  try {
    await Storage.saveBookNavConfig({ baseUrl, token });
    const user = await BookNavClient.testConnection();
    const categories = await BookNavClient.fetchCategories();
    const config = await Storage.getBookNavConfig();
    updatePairStatus(user, categories, config.lastSyncAt);
    showToast('连接成功，分类已同步', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(optionEls.saveBooknav, false, '保存并测试');
  }
}

async function syncCategories() {
  setBusy(optionEls.syncCategories, true, '同步中...');
  try {
    const categories = await BookNavClient.fetchCategories();
    const config = await Storage.getBookNavConfig();
    updatePairStatus(config.user, categories, config.lastSyncAt);
    showToast(`已同步 ${categories.length} 个分类`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(optionEls.syncCategories, false, '同步分类');
  }
}

async function clearBookNavToken() {
  if (!confirm('确定清除插件内保存的 Token？')) return;
  await Storage.clearBookNavToken();
  await loadBookNavConfig();
  showToast('Token 已清除', 'success');
}

async function loadProviderConfig() {
  const provider = await Storage.getActiveProvider();
  if (provider) {
    optionEls.providerName.value = provider.name || '';
    optionEls.providerBaseUrl.value = provider.baseUrl || '';
    optionEls.providerApiKey.value = provider.apiKey || '';
  }
  await renderModels();
  updateAIStatus(provider, await Storage.getActiveModel());
}

async function saveProvider() {
  const provider = {
    id: 'default-provider',
    name: optionEls.providerName.value.trim() || 'AI Provider',
    baseUrl: optionEls.providerBaseUrl.value.trim(),
    apiKey: optionEls.providerApiKey.value.trim()
  };
  if (!provider.baseUrl || !provider.apiKey) {
    showToast('请填写 AI Base URL 和 API Key', 'error');
    return;
  }
  await Storage.saveProviders([provider]);
  await Storage.setActiveProvider(provider.id);
  updateAIStatus(provider, await Storage.getActiveModel());
  showToast('AI 提供商已保存', 'success');
}

async function fetchModels() {
  await saveProvider();
  const provider = await Storage.getActiveProvider();
  setBusy(optionEls.fetchModels, true, '获取中...');
  try {
    const fetched = await AI.fetchModels(provider.baseUrl, provider.apiKey);
    const models = fetched.map((model) => ({
      id: model.id,
      name: model.name,
      providerId: provider.id
    }));
    await Storage.saveModels(models);
    if (models[0]) await Storage.setActiveModel(models[0].id);
    await renderModels();
    updateAIStatus(provider, await Storage.getActiveModel());
    showToast(`已获取 ${models.length} 个模型`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(optionEls.fetchModels, false, '获取模型');
  }
}

async function renderModels() {
  const models = await Storage.getModels();
  const active = await Storage.getActiveModel();
  optionEls.modelSelect.innerHTML = '<option value="">请选择模型</option>';
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    if (active && active.id === model.id) option.selected = true;
    optionEls.modelSelect.appendChild(option);
  });
}

async function addManualModel() {
  const provider = await Storage.getActiveProvider();
  if (!provider) {
    showToast('请先保存 AI 提供商', 'error');
    return;
  }
  const name = optionEls.manualModel.value.trim();
  if (!name) {
    showToast('请输入模型名', 'error');
    return;
  }
  const models = await Storage.getModels();
  const model = { id: name, name, providerId: provider.id };
  const nextModels = [...models.filter((item) => item.id !== name), model];
  await Storage.saveModels(nextModels);
  await Storage.setActiveModel(model.id);
  optionEls.manualModel.value = '';
  await renderModels();
  updateAIStatus(provider, model);
  showToast('模型已添加', 'success');
}

async function testCurrentModel() {
  const provider = await Storage.getActiveProvider();
  const model = await Storage.getActiveModel();
  if (!provider || !model) {
    showToast('请先配置提供商和模型', 'error');
    return;
  }
  setBusy(optionEls.testModel, true, '测试中...');
  try {
    await AI.testModel(provider.baseUrl, provider.apiKey, model.name);
    showToast('模型可用', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(optionEls.testModel, false, '测试模型');
  }
}

function updateAIStatus(provider, model) {
  if (provider && model) {
    optionEls.aiStatus.textContent = `${provider.name} / ${model.name}`;
    optionEls.aiStatus.className = 'badge success';
  } else {
    optionEls.aiStatus.textContent = '未配置';
    optionEls.aiStatus.className = 'badge warning';
  }
}

async function loadPromptConfig() {
  const templates = await Storage.getPromptTemplates();
  optionEls.prompt.value = templates.classify;
}

async function savePrompt() {
  await Storage.savePromptTemplates({ classify: optionEls.prompt.value });
  showToast('提示词已保存', 'success');
}

async function resetPrompt() {
  await Storage.remove('promptTemplates');
  await loadPromptConfig();
  showToast('已恢复默认提示词', 'success');
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.textContent = text;
}

function showToast(message, type = 'success') {
  optionEls.toast.textContent = message;
  optionEls.toast.className = `toast ${type}`;
  setTimeout(() => {
    optionEls.toast.className = 'toast hidden';
  }, 3200);
}
