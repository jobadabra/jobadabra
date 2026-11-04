"""The `api` engine: the Anthropic SDK with the user's ANTHROPIC_API_KEY (or Free AI's address). Billed per token.

The caller's params go to the SDK as written (only a schema's maxItems/minItems come out, for_api; prompt caching's cache_control, effort, the web search tool) and its response comes back as
it is: the Anthropic path is the contract's reference shape, so nothing is translated. Guarded by tests/unit/ai/test_ai_providers.py.
"""
import os

from .contract import Adapter, AiLimit
from .schema import without_limits

ACTIONS = ('enrich', 'score', 'kit', 'prep', 'insight', 'mail', 'inbox', 'review', 'interview', 'interview_patterns', 'opportunity', 'added', 'import', 'scout', 'decide', 'tailor', 'cover_letter', 'answer', 'answer_review', 'web_search',
           # The engine's other steps (26 Oct 2026: sent with no name, Free AI logged 517 of their calls as one "other" row). Guard: tests/guards/money/test_engine_action.py.
           'title_triage', 'place_triage', 'place_vague', 'place_reading', 'visit_reader', 'visit_reader_second', 'visit_relevant', 'visit_filters', 'visit_unblock',
           'visit_unblock_second', 'role_ideas', 'role_counts', 'job_page_pick', 'field_redraft', 'few_jobs', 'board_queries', 'places')


def sdk(action=''):
    """The SDK client. `action` names the AI step (one of ACTIONS) in a header Free AI's route reads, so what each step costs can be
    told apart there (site/src/trial.js); Anthropic itself ignores it. Nothing about the job or the user is in it."""
    import anthropic
    options = {}
    if os.environ.get('JOBADABRA_AI_BASE_URL'):   # an Always on run on Free AI: the repo variable the app sets (an empty ANTHROPIC_BASE_URL would break the SDK)
        options['base_url'] = os.environ['JOBADABRA_AI_BASE_URL']
    if action in ACTIONS:
        options['default_headers'] = {'x-jp-action': action}
    return anthropic.Anthropic(**options)


def transient_errors():
    """The SDK's errors that mean "down or busy, try the next run" (after its own retries)."""
    try:
        import anthropic
    except ImportError:
        return ()
    return (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.InternalServerError)


def permanent_errors():
    try:
        import anthropic
    except ImportError:
        return ()
    return (anthropic.APIStatusError,)


def for_api(params):
    """The one place every ask to the API passes through: the schema without maxItems/minItems, which the API refuses in structured output (400).
    Callers write them to cap their own lists and check the answer themselves; everything else in the params stays as written."""
    shape = (params.get('output_config') or {}).get('format')
    if not shape or not shape.get('schema'):
        return params
    return dict(params, output_config=dict(params['output_config'], format=dict(shape, schema=without_limits(shape['schema']))))


def named_by_answer(response):
    """Free AI answers with an open model (its Message names it, e.g. '@cf/qwen/...'); the SDK's usage never says who answered, so cost.py
    would name and price the Claude model that was asked for. Put the answering model on the usage when it is not a Claude one (26 Oct 2026:
    a Free AI run said "with claude-sonnet-5-5" and counted $0.30). An unpriced model counts as $0 in cost.PRICES."""
    said, usage = getattr(response, 'model', ''), getattr(response, 'usage', None)
    if isinstance(said, str) and said and not said.startswith('claude') and usage is not None:
        try:
            usage.model = said
            usage.provider = 'free'   # cron_report's "Billed to" says Free AI, not Anthropic API credits
        except (AttributeError, TypeError, ValueError):
            pass
    return response


KEY_TEXT = 'The AI key was refused (Settings → Connections → AI): check it, or switch engines there.'


def key_refused(error):
    """An Anthropic SDK error answering 401: the key (or Free AI's trial key) is not accepted. Read by the error's package and status, so nothing here needs the SDK installed.
    Why (se, 4 Nov 2026, code review): not a 403: Anthropic also answers 403 for a model or region this key may not use, which skips that one job; calling it a refused key would stop the whole run."""
    return type(error).__module__.split('.')[0] == 'anthropic' and getattr(error, 'status_code', None) == 401


def refused(error):
    """A refused key as the contract's `AiLimit` (final: no retry helps), keeping the API's own status and error type for the log (contract.error_facts).
    Why (se, 4 Nov 2026, Sentry APP-42/43/44): the SDK's raw 401 left this adapter, so interview, interview insights and a run's AI judgments failed with
    "AuthenticationError: invalid x-api-key"; the OpenAI adapter (openai_api.error_of) already maps its 401/403 this way."""
    body = getattr(error, 'body', None)
    body = body.get('error', body) if isinstance(body, dict) else {}
    limit = AiLimit(KEY_TEXT, final=True)
    limit.ai_status, limit.code = error.status_code, str(body.get('type') or '') if isinstance(body, dict) else ''
    return limit


class AnthropicApi(Adapter):
    name, family = 'api', 'claude'
    label = 'Anthropic API'

    def __init__(self, client=None, action='', log=None):
        super().__init__(log=log)
        self.client = client if client is not None else sdk(action)   # made now, as before: a missing SDK says so at once

    def complete(self, request):
        try:
            response = self.client.messages.create(**for_api(request.params))
        except Exception as error:   # noqa: BLE001 - only a refused key is mapped; every other SDK error leaves as it was
            if key_refused(error):
                raise refused(error) from error
            raise
        return named_by_answer(response)
