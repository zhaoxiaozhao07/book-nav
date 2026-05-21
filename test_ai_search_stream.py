import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parent / "app" / "utils" / "ai_search.py"
SPEC = importlib.util.spec_from_file_location("ai_search_under_test", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("无法加载 ai_search.py 进行测试")

ai_search = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ai_search)


class FakeStreamResponse:
    def __init__(self, lines):
        self._lines = lines

    def iter_lines(self, decode_unicode=True):
        return iter(self._lines)


def make_service():
    return ai_search.AISearchService(
        api_base_url="https://example.test",
        api_key="test-key",
        model_name="test-model",
    )


def data_line(payload):
    return f"data: {json.dumps(payload, ensure_ascii=False)}"


class AISearchStreamParsingTests(unittest.TestCase):
    def test_chat_stream_extracts_content_array_json(self):
        service = make_service()
        lines = [
            data_line({"choices": [{"delta": {"role": "assistant"}}]}),
            "",
            data_line({"choices": [{"delta": {"content": [{"type": "text", "text": '{"intent":"查找 AI 文档"'}]}}]}),
            "",
            data_line({"choices": [{"delta": {"content": [{"type": "text", "text": ',"keywords":["AI","文档"],"search_type":"semantic"}'}]}}]}),
            "",
            "data: [DONE]",
            "",
        ]

        response = service._parse_chat_sse_response(FakeStreamResponse(lines))
        content = service._extract_response_text(response)
        parsed = service._parse_json_response(content)

        self.assertEqual(parsed["intent"], "查找 AI 文档")
        self.assertEqual(parsed["keywords"], ["AI", "文档"])

    def test_chat_stream_extracts_root_response_delta_event(self):
        service = make_service()
        lines = [
            "event: response.output_text.delta",
            data_line({"delta": "hello"}),
            "",
            "data: [DONE]",
            "",
        ]

        response = service._parse_chat_sse_response(FakeStreamResponse(lines))
        self.assertEqual(service._extract_response_text(response), "hello")

    def test_chat_stream_extracts_multiline_sse_data(self):
        service = make_service()
        lines = [
            "event: response.output_text.delta",
            "data: {\"delta\":",
            "data: \"hello\"}",
            "",
            "data: [DONE]",
            "",
        ]

        response = service._parse_chat_sse_response(FakeStreamResponse(lines))
        self.assertEqual(service._extract_response_text(response), "hello")

    def test_chat_stream_reports_reasoning_without_final_text(self):
        service = make_service()
        lines = [
            data_line({"choices": [{"delta": {"reasoning_content": "先分析用户意图"}}]}),
            "",
            data_line({"choices": [{"delta": {}, "finish_reason": "length"}]}),
            "",
            "data: [DONE]",
            "",
        ]

        with self.assertRaises(ai_search.AIEmptyResponseError) as context:
            service._parse_chat_sse_response(FakeStreamResponse(lines))

        message = str(context.exception)
        self.assertIn("推理内容", message)
        self.assertIn("token", message)

    def test_chat_stream_rejects_oversized_sse_event(self):
        service = make_service()
        oversized_text = "x" * ai_search.AI_SSE_EVENT_MAX_BYTES
        lines = [
            data_line({"choices": [{"delta": {"content": oversized_text}}]}),
            "",
        ]

        with self.assertRaises(ai_search.AICompatibilityError) as context:
            service._parse_chat_sse_response(FakeStreamResponse(lines))

        self.assertIn("单个事件过大", str(context.exception))

    def test_chat_stream_rejects_unterminated_oversized_sse_event(self):
        service = make_service()
        chunk = "x" * (ai_search.AI_SSE_EVENT_MAX_BYTES // 4)
        lines = [f"data: {chunk}" for _ in range(5)]

        with self.assertRaises(ai_search.AICompatibilityError) as context:
            service._parse_chat_sse_response(FakeStreamResponse(lines))

        self.assertIn("单个事件过大", str(context.exception))

    def test_stream_content_extraction_has_depth_limit(self):
        service = make_service()
        content = "should not be reached"
        for _ in range(ai_search.AI_STREAM_CONTENT_MAX_DEPTH + 2):
            content = {"content": content}

        self.assertEqual(service._coerce_stream_content_to_text(content), "")

    def test_stream_content_extraction_has_node_limit(self):
        service = make_service()
        content = [""] * (ai_search.AI_STREAM_CONTENT_MAX_NODES + 10)
        content.append("should not be reached")

        self.assertEqual(service._coerce_stream_content_to_text(content), "")

    def test_chat_stream_rejects_excessive_aggregated_text(self):
        service = make_service()
        first = "a" * (ai_search.AI_STREAM_TEXT_MAX_CHARS // 2 + 1)
        second = "b" * (ai_search.AI_STREAM_TEXT_MAX_CHARS // 2 + 1)
        lines = [
            data_line({"choices": [{"delta": {"content": first}}]}),
            "",
            data_line({"choices": [{"delta": {"content": second}}]}),
            "",
        ]

        with self.assertRaises(ai_search.AICompatibilityError) as context:
            service._parse_chat_sse_response(FakeStreamResponse(lines))

        self.assertIn("文本过大", str(context.exception))

    def test_analyze_search_intent_uses_larger_token_budget(self):
        class RecordingService(ai_search.AISearchService):
            def __init__(self):
                super().__init__(
                    api_base_url="https://example.test",
                    api_key="test-key",
                    model_name="test-model",
                )
                self.recorded_max_tokens = None

            def _call_api(self, messages, temperature=None, max_tokens=None, expect_json=False):
                self.recorded_max_tokens = max_tokens
                return {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "intent": "查找 AI 文档",
                                        "keywords": ["AI", "文档"],
                                        "related_terms": [],
                                        "category_hints": [],
                                        "search_type": "semantic",
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                }

        service = RecordingService()
        result = service.analyze_search_intent("帮我找 AI 文档站点")

        self.assertEqual(service.recorded_max_tokens, 800)
        self.assertEqual(result["intent"], "查找 AI 文档")


if __name__ == "__main__":
    unittest.main()
