"""The words a country's job boards are searched with for role families, in that country's language, proposed by the AI for the Central Scout.
Why (12 Nov 2026, owner, asked via AskUserQuestion: "Scout asks once per country (Recommended)"): the board pass filled a local board's {role} with
the families' English words (src/pool_tags.py FAMILIES), and a local board answered none: the same reader on the same Slovak board gave 0 jobs for
"cooking" and 5 for the Slovak word for a cook. An install searches with its person's own words; only the scout had English ones. One call names
every family's words for one country; the code keeps short plain words only. Tests: tests/unit/ai/test_board_words.py."""
import json

from .models import MAIN_MODEL
from .providers.contract import detail, reason

MODEL = MAIN_MODEL
MAX_WORDS = 3            # words kept per family (the board pass searches the first)
MAX_LEN = 40             # a search word longer than this is a sentence, not a word
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['families'], 'properties': {'families': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['family', 'words'],
    'properties': {'family': {'type': 'string', 'description': 'the family id exactly as given'},
                   'words': {'type': 'array', 'items': {'type': 'string'}, 'description': '1 to 3 search words, most used first'}}}}}}
SYSTEM = """You know how people search job boards in each country. You get a country and kinds of work, each an id with English words. \
For each kind, give 1 to 3 words a person in that country types into a local job board's search box to find these jobs: in the country's \
main language as job ads there write them (the job title most ads use, singular, no gender pair, no quotes), most used first. When English \
is what ads there use for that work, give the English word. Every id once, exactly as given."""


def words(country, families, client=None):
    """{family: [words]} for these families ({id: English words}) in `country` (an English country name), each list cleaned (short plain words,
    at most MAX_WORDS, each once); families the AI left out are absent. None without AI or when the call failed (said in the log)."""
    from ..press import stage
    answer = None
    with stage.guard('board words') as caught:   # the search path's one catch-all (tests/guards/rules/test_catch_alls_only_shrink.py)
        from . import cost, engine
        if client is None:
            if not engine.ready():
                return None
            client = engine.client(action='scout')
        response = client.messages.create(
            model=MODEL, max_tokens=1500, system=[{'type': 'text', 'text': SYSTEM}],
            messages=[{'role': 'user', 'content': json.dumps({'country': country, 'kinds': [{'id': key, 'words': text} for key, text in families.items()]},
                                                            ensure_ascii=False)}],
            output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        if response.stop_reason != 'end_turn':
            raise RuntimeError(f'stopped with {response.stop_reason}')
        answer = json.loads(next(block.text for block in response.content if block.type == 'text')).get('families') or []
    if caught.error:   # the English words still search
        print(f"Board words: none from the AI this time ({reason(caught.error)}); {country}'s boards are searched with the English words", flush=True)
        detail('board words', caught.error)
        return None
    out = {}
    for item in answer:
        family = str((item or {}).get('family') or '')
        if family in families and family not in out:
            kept = [word.strip() for word in (item.get('words') or []) if isinstance(word, str) and 0 < len(word.strip()) <= MAX_LEN and '\n' not in word]
            if kept:
                out[family] = list(dict.fromkeys(kept))[:MAX_WORDS]
    return out
