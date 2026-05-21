const elements = {
  settingsBtn: document.getElementById('settingsBtn'),
  warning: document.getElementById('connectionWarning'),
  form: document.getElementById('bookmarkForm'),
  url: document.getElementById('urlInput'),
  title: document.getElementById('titleInput'),
  description: document.getElementById('descriptionInput'),
  titleCount: document.getElementById('titleCount'),
  descriptionCount: document.getElementById('descriptionCount'),
  category: document.getElementById('categorySelect'),
  status: document.getElementById('statusMessage'),
  saveBtn: document.getElementById('saveBtn'),
  aiBtn: document.getElementById('aiBtn'),
  publicOption: document.getElementById('publicOption'),
  privateOption: document.getElementById('privateOption')
};

let categories = [];

document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup() {
  bindEvents();
  updateCounts();
  updateVisibilityState();

  try {
    const page = await getInitialPage();
    elements.url.value = page.url;
    elements.title.value = (page.title || '').slice(0, 100);
    updateCounts();
  } catch (error) {
    showStatus(error.message, 'error');
  }

  await refreshConnectionAndCategories();
}

async function getInitialPage() {
  const { pendingPage } = await chrome.storage.local.get('pendingPage');
  if (pendingPage?.url && Date.now() - Number(pendingPage.createdAt || 0) < 120000) {
    await chrome.storage.local.remove('pendingPage');
    return { title: pendingPage.title || '', url: pendingPage.url };
  }
  return PageCapture.getActiveTab();
}

function bindEvents() {
  elements.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.form.addEventListener('submit', saveBookmark);
  elements.aiBtn.addEventListener('click', recommendCategory);
  elements.title.addEventListener('input', updateCounts);
  elements.description.addEventListener('input', updateCounts);
  document.querySelectorAll('input[name="visibility"]').forEach((input) => {
    input.addEventListener('change', updateVisibilityState);
  });
}

async function refreshConnectionAndCategories() {
  const config = await Storage.getBookNavConfig();
  const paired = Boolean(config.baseUrl && config.token);
  elements.warning.classList.toggle('hidden', paired);
  if (!paired) {
    setActionsDisabled(true);
    return;
  }

  try {
    await BookNavClient.testConnection();
    categories = await BookNavClient.fetchCategories();
    renderCategories(categories);
    setActionsDisabled(categories.length === 0);
    if (categories.length === 0) {
      showStatus('后台还没有分类，请先到管理后台手动新增分类。', 'error');
    }
  } catch (error) {
    elements.warning.classList.remove('hidden');
    setActionsDisabled(true);
    showStatus(error.message, 'error');
  }
}

function renderCategories(items) {
  elements.category.innerHTML = '<option value="">选择或搜索分类</option>';
  items.forEach((category) => {
    const option = document.createElement('option');
    option.value = String(category.id);
    option.textContent = category.path || category.name;
    elements.category.appendChild(option);
  });
}

function setActionsDisabled(disabled) {
  elements.saveBtn.disabled = disabled;
  elements.aiBtn.disabled = disabled;
  elements.category.disabled = disabled;
}

function updateCounts() {
  elements.titleCount.textContent = `${elements.title.value.length}/100`;
  elements.descriptionCount.textContent = `${elements.description.value.length}/200`;
}

function updateVisibilityState() {
  const value = document.querySelector('input[name="visibility"]:checked')?.value || 'public';
  elements.publicOption.classList.toggle('active', value === 'public');
  elements.privateOption.classList.toggle('active', value === 'private');
}

async function saveBookmark(event) {
  event.preventDefault();
  hideStatus();

  const payload = buildPayload();
  if (!payload) return;

  setBusy(elements.saveBtn, true, '保存中...');
  try {
    const duplicate = await BookNavClient.checkUrl(payload.url);
    if (duplicate.exists) {
      const confirmed = confirm(`该链接已存在于“${duplicate.website.category_name || '未分类'}”。仍要重复添加吗？`);
      if (!confirmed) return;
      payload.force = true;
    }

    const result = await BookNavClient.createBookmark(payload);
    showStatus(result.message || '书签已保存', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(elements.saveBtn, false, '保存');
  }
}

function buildPayload() {
  const url = elements.url.value.trim();
  const title = elements.title.value.trim();
  const categoryId = Number(elements.category.value);
  if (!/^https?:\/\//i.test(url)) {
    showStatus('请输入有效的 http/https URL', 'error');
    return null;
  }
  if (!title) {
    showStatus('请输入链接名称', 'error');
    return null;
  }
  if (!categoryId) {
    showStatus('请选择已有分类', 'error');
    return null;
  }

  return {
    url,
    title,
    description: elements.description.value.trim(),
    category_id: categoryId,
    is_private: document.querySelector('input[name="visibility"]:checked')?.value === 'private'
  };
}

async function recommendCategory() {
  hideStatus();
  if (!categories.length) {
    showStatus('没有可推荐的已有分类，请先同步分类。', 'error');
    return;
  }

  setBusy(elements.aiBtn, true, '推荐中...');
  try {
    const provider = await Storage.getActiveProvider();
    const model = await Storage.getActiveModel();
    if (!provider || !model) {
      throw new Error('请先在设置页配置 AI 提供商和模型');
    }

    const templates = await Storage.getPromptTemplates();
    const categoryText = categories.map((item) => `${item.id}: ${item.path || item.name}`).join('\n');
    const prompt = templates.classify
      .replace('{title}', elements.title.value.trim())
      .replace('{url}', elements.url.value.trim())
      .replace('{description}', elements.description.value.trim())
      .replace('{categories}', categoryText) + `

无论上方模板如何描述，最终必须只返回 JSON：
{
  "category_id": 已有分类ID整数,
  "description": "不超过200字的链接描述；没有有效信息时返回空字符串",
  "reason": "不超过40字的推荐理由"
}`;

    const parsed = await requestAIRecommendation(provider, model, prompt);
    const categoryId = Number(parsed.category_id);
    const matched = categories.find((item) => item.id === categoryId);
    if (!matched) {
      throw new Error('AI 返回了不存在的分类，已拦截。请手动选择已有分类。');
    }

    const generatedDescription = normalizeGeneratedDescription(parsed.description);
    elements.category.value = String(matched.id);
    elements.description.value = generatedDescription;
    updateCounts();

    const descriptionStatus = generatedDescription ? '，描述已生成' : '，没有可用描述';
    showStatus(`已推荐：${matched.path || matched.name}${descriptionStatus}${parsed.reason ? `（${parsed.reason}）` : ''}`, 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(elements.aiBtn, false, 'AI 分类');
  }
}

async function requestAIRecommendation(provider, model, prompt) {
  const messages = [
    {
      role: 'system',
      content: 'You choose exactly one existing bookmark category and generate a concise link description. Return JSON only with category_id, description, and reason. description must be an empty string when there is no useful information.'
    },
    { role: 'user', content: prompt }
  ];
  try {
    const content = await AI.chat(provider.baseUrl, provider.apiKey, model.name, messages, true);
    return AI.parseJSON(content);
  } catch (error) {
    const message = String(error.message || '');
    if (!/response_format|json_object|JSON/i.test(message)) {
      throw error;
    }
    const content = await AI.chat(provider.baseUrl, provider.apiKey, model.name, messages, false);
    return AI.parseJSON(content);
  }
}

function normalizeGeneratedDescription(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  const invalidDescriptions = new Set([
    '无',
    '暂无',
    '无描述',
    '暂无描述',
    '无有效信息',
    '没有有效信息',
    '无法判断',
    '无法确定',
    '未知',
    'n/a',
    'na',
    'null',
    'undefined',
    'none'
  ]);
  if (invalidDescriptions.has(text.toLowerCase())) {
    return '';
  }

  return Array.from(text).slice(0, 200).join('');
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.textContent = text;
}

function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = `status-message ${type || ''}`;
}

function hideStatus() {
  elements.status.className = 'status-message hidden';
  elements.status.textContent = '';
}
