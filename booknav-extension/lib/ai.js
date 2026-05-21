const AI = {
  normalizeUrl(baseUrl) {
    return (baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  },

  async fetchModels(baseUrl, apiKey) {
    const response = await fetch(`${this.normalizeUrl(baseUrl)}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`获取模型失败 (${response.status}): ${error}`);
    }

    const data = await response.json();
    return (data.data || []).map((model) => ({
      id: model.id,
      name: model.id,
      owned_by: model.owned_by || ''
    }));
  },

  async testModel(baseUrl, apiKey, modelName) {
    const content = await this.chat(baseUrl, apiKey, modelName, [
      { role: 'user', content: '请回复 OK，用于验证模型可用。' }
    ]);
    return Boolean(content);
  },

  async chat(baseUrl, apiKey, modelName, messages, expectJson = false) {
    const body = {
      model: modelName,
      messages,
      temperature: 0.2
    };
    if (expectJson) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.normalizeUrl(baseUrl)}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`AI 调用失败 (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI 未返回有效内容');
    }
    return content;
  },

  parseJSON(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let jsonText = fenced ? fenced[1] : text;
    jsonText = jsonText.trim();
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end >= start) {
      jsonText = jsonText.slice(start, end + 1);
    }
    return JSON.parse(jsonText);
  }
};
