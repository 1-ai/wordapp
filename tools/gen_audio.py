"""엑셀의 단어/뜻을 Microsoft 신경망 음성(edge-tts)으로 mp3로 만들어 audio/ 에 저장합니다.
사용:  pip install edge-tts openpyxl
       python tools/gen_audio.py "../단어_암기_리스트_v2.xlsx"
새 단어를 추가한 뒤 다시 실행하면 없는 것만 새로 만듭니다."""
import asyncio, json, os, sys
import openpyxl, edge_tts

VOICES = {'영어': 'en-US-AriaNeural', '스페인어': 'es-ES-ElviraNeural', '일본어': 'ja-JP-NanamiNeural',
          '중국어': 'zh-CN-XiaoxiaoNeural', '한국어': 'ko-KR-SunHiNeural'}
RATE = {'한국어': '+0%'}          # 그 외 단어는 약간 천천히
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audio')


def fnv(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h = ((h ^ b) * 0x01000193) & 0xffffffff
    return format(h, '08x')


async def one(sem, key, text, lang, path):
    async with sem:
        for _ in range(3):
            try:
                await edge_tts.Communicate(text, VOICES[lang], rate=RATE.get(lang, '-10%')).save(path)
                return True
            except Exception as e:
                err = e
                await asyncio.sleep(1)
        print('실패:', key, err)
        return False


async def main(xlsx):
    ws = openpyxl.load_workbook(xlsx, data_only=True)['단어']
    items = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[4] or (len(r) > 15 and r[15] is True):
            continue
        lang, word, meaning = (r[2] or '영어'), str(r[4]).strip(), str(r[5] or '').strip()
        if lang in VOICES: items[f'{lang}|{word}'] = (word, lang)
        if meaning: items[f'한국어|{meaning}'] = (meaning, '한국어')
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, 'index.json')
    index = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {}
    sem = asyncio.Semaphore(6)
    todo = []
    for key, (text, lang) in items.items():
        fn = fnv(key) + '.mp3'
        path = os.path.join(OUT, fn)
        if os.path.exists(path) and os.path.getsize(path) > 500:
            index[key] = fn
        else:
            todo.append((key, text, lang, fn, path))
    print(f'전체 {len(items)}개 중 새로 만들 것 {len(todo)}개')
    res = await asyncio.gather(*[one(sem, k, t, l, p) for k, t, l, f, p in todo])
    for (k, t, l, f, p), ok in zip(todo, res):
        if ok: index[k] = f
    json.dump(index, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print('완료:', len(index), '개 음성')

asyncio.run(main(sys.argv[1]))
