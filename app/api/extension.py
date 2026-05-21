#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Token-authenticated APIs for the BookNav Chrome extension."""

from datetime import datetime
from functools import wraps
import json
from urllib.parse import urlparse

from flask import current_app, g, jsonify, request

from app import csrf, db
from app.api import bp
from app.models import Category, OperationLog, SiteSettings, User, Website
from app.utils.icon_service import sync_icon_after_save


def _json_error(message, status_code=400):
    return jsonify({'success': False, 'message': message}), status_code


def _extract_bearer_token():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.lower().startswith('bearer '):
        return ''
    return auth_header.split(None, 1)[1].strip()


def extension_token_required(view_func):
    @wraps(view_func)
    def decorated(*args, **kwargs):
        token = _extract_bearer_token()
        user = User.verify_extension_api_token(token)
        if not user:
            return _json_error('插件 API Token 无效或已过期，请在后台重新生成并配对。', 401)

        user.extension_token_last_used_at = datetime.utcnow()
        db.session.add(user)
        db.session.commit()
        g.extension_user = user
        return view_func(*args, **kwargs)

    return decorated


def _normalize_url(value):
    url = (value or '').strip()
    if not url:
        return ''
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return ''
    return url


def _category_path(category):
    names = [ancestor.name for ancestor in category.get_ancestors()]
    names.append(category.name)
    return ' / '.join([name for name in names if name])


def _serialize_category(category):
    return {
        'id': category.id,
        'name': category.name or '',
        'description': category.description or '',
        'icon': category.icon or '',
        'color': category.color or '',
        'parent_id': category.parent_id,
        'order': category.order or 0,
        'path': _category_path(category),
    }


def _categories_for_user(user):
    return Category.query.order_by(Category.order.asc(), Category.name.asc(), Category.id.asc()).all()


def _find_duplicate_url(url, user):
    normalized = url[:-1] if url.endswith('/') else url
    variants = [normalized, normalized + '/']
    return Website.query.filter(
        Website.url.in_(variants),
        Website.created_by_id == user.id
    ).first()


def _serialize_website(website):
    return {
        'id': website.id,
        'title': website.title or '',
        'url': website.url or '',
        'description': website.description or '',
        'icon': website.display_icon_url,
        'raw_icon': website.icon or '',
        'category_id': website.category_id,
        'category_name': website.category.name if website.category else '',
        'is_private': bool(website.is_private),
        'created_at': website.created_at.isoformat() if website.created_at else '',
    }


def _normalize_ai_description(value):
    if not isinstance(value, str):
        return ''

    text = ' '.join(value.split()).strip()
    if not text:
        return ''

    invalid_descriptions = {
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
        'none',
    }
    if text.lower() in invalid_descriptions:
        return ''

    return text[:200]


def _trigger_vector_indexing(website, category_name):
    try:
        from app.main.api_website import _trigger_vector_indexing as trigger_vector_indexing

        trigger_vector_indexing(website.id, category_name)
    except Exception as exc:
        current_app.logger.warning(f"插件新增网站后触发向量生成失败: {str(exc)}")


@bp.route('/extension/me', methods=['GET'])
@csrf.exempt
@extension_token_required
def extension_me():
    user = g.extension_user
    return jsonify({
        'success': True,
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'is_admin': bool(user.is_admin),
        }
    })


@bp.route('/extension/categories', methods=['GET'])
@csrf.exempt
@extension_token_required
def extension_categories():
    user = g.extension_user
    categories = [_serialize_category(category) for category in _categories_for_user(user)]
    return jsonify({'success': True, 'categories': categories})


@bp.route('/extension/check-url', methods=['GET'])
@csrf.exempt
@extension_token_required
def extension_check_url():
    user = g.extension_user
    url = _normalize_url(request.args.get('url', ''))
    if not url:
        return _json_error('URL 格式不正确', 400)

    website = _find_duplicate_url(url, user)
    if not website:
        return jsonify({'success': True, 'exists': False})

    return jsonify({
        'success': True,
        'exists': True,
        'website': _serialize_website(website),
    })


@bp.route('/extension/bookmarks', methods=['POST'])
@csrf.exempt
@extension_token_required
def extension_create_bookmark():
    user = g.extension_user
    data = request.get_json(silent=True) or {}

    url = _normalize_url(data.get('url', ''))
    if not url:
        return _json_error('URL 格式不正确', 400)

    title = (data.get('title') or '').strip()[:128]
    if not title:
        return _json_error('链接名称不能为空', 400)

    description = (data.get('description') or '').strip()[:512]
    icon = (data.get('icon') or '').strip()[:256]

    raw_category_id = data.get('category_id')
    if raw_category_id in (None, ''):
        return _json_error('请选择有效分类', 400)

    try:
        category_id = int(raw_category_id)
    except (TypeError, ValueError):
        return _json_error('请选择有效分类', 400)

    category_ids = {category.id for category in _categories_for_user(user)}
    if category_id not in category_ids:
        return _json_error('分类不存在或不属于当前用户可用范围，请先在后台新增分类。', 403)

    duplicate = _find_duplicate_url(url, user)
    if duplicate and not data.get('force'):
        return jsonify({
            'success': False,
            'code': 'duplicate_url',
            'message': '该链接已存在于你的书签中',
            'website': _serialize_website(duplicate),
        }), 409

    try:
        website = Website(
            title=title,
            url=url,
            description=description,
            icon=icon,
            category_id=category_id,
            created_by_id=user.id,
            sort_order=0,
            is_private=bool(data.get('is_private')),
        )
        db.session.add(website)
        db.session.flush()

        category = Category.query.get(category_id)
        category_name = category.name if category else None
        operation_log = OperationLog(
            user_id=user.id,
            operation_type='ADD',
            website_id=website.id,
            website_title=website.title,
            website_url=website.url,
            website_icon=website.icon,
            category_id=website.category_id,
            category_name=category_name,
            details=json.dumps({'source': 'chrome_extension'}, ensure_ascii=False),
        )
        db.session.add(operation_log)
        db.session.commit()

        try:
            sync_icon_after_save(
                website,
                icon_url=icon,
                auto_fetch=bool(SiteSettings.get_settings().icon_auto_fetch_on_create),
            )
        except Exception as exc:
            current_app.logger.warning(f"插件新增网站后同步图标失败: {str(exc)}")
        _trigger_vector_indexing(website, category_name)

        return jsonify({
            'success': True,
            'message': '书签已保存到导航',
            'website': _serialize_website(website),
        }), 201
    except Exception as exc:
        db.session.rollback()
        return _json_error(f'保存失败: {str(exc)}', 500)


@bp.route('/extension/recommend-category', methods=['POST'])
@csrf.exempt
@extension_token_required
def extension_recommend_category():
    user = g.extension_user
    data = request.get_json(silent=True) or {}
    categories = [_serialize_category(category) for category in _categories_for_user(user)]
    if not categories:
        return _json_error('当前账号还没有可推荐的分类，请先到后台新增分类。', 400)

    settings = SiteSettings.get_settings()
    try:
        from app.utils.ai_search import create_ai_service_from_settings

        ai_service = create_ai_service_from_settings(settings, task='site_info')
    except Exception as exc:
        current_app.logger.warning(f"创建插件 AI 分类服务失败: {str(exc)}")
        ai_service = None

    if not ai_service:
        return _json_error('后台 AI 服务未配置，无法使用 AI 分类推荐。', 400)

    category_lines = '\n'.join([f"- {category['id']}: {category['path']}" for category in categories])
    prompt = f"""
你是书签分类和描述助手。请只从下面已有分类中选择最适合的一个分类，并生成适合保存到导航站的链接描述。
禁止创建新分类，禁止返回不存在的分类。

当前页面：
- 标题：{(data.get('title') or '').strip()}
- URL：{(data.get('url') or '').strip()}
- 描述：{(data.get('description') or '').strip()}

已有分类：
{category_lines}

要求：
1. category_id 必须来自已有分类。
2. description 用简洁中文概括链接用途或内容，不超过 200 字。
3. 如果标题、URL 和已有描述都无法判断出有效信息，description 必须返回空字符串。

请返回 JSON：{{"category_id": 分类ID整数, "description": "链接描述或空字符串", "reason": "不超过40字的推荐理由"}}
""".strip()

    try:
        response = ai_service._call_api(
            [
                {'role': 'system', 'content': 'You select one existing bookmark category and generate a concise description. Return JSON only with category_id, description, and reason.'},
                {'role': 'user', 'content': prompt},
            ],
            temperature=0.2,
            max_tokens=280,
            expect_json=True,
        )
        content = ai_service._extract_response_text(response)
        parsed = ai_service._parse_json_response(content)
        category_id = int(parsed.get('category_id'))
    except Exception as exc:
        return _json_error(f'AI 分类推荐失败: {str(exc)}', 500)

    category_by_id = {category['id']: category for category in categories}
    if category_id not in category_by_id:
        return _json_error('AI 返回了不存在的分类，已拦截。请手动选择已有分类。', 422)

    reason = (parsed.get('reason') or '').strip()[:80]
    description = _normalize_ai_description(parsed.get('description'))
    return jsonify({
        'success': True,
        'category_id': category_id,
        'category': category_by_id[category_id],
        'description': description,
        'reason': reason,
    })
