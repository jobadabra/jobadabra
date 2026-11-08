"""The job boards' employer report (src/sources/boards.py discover): reports/companies.html, .json (imported by the search: daily_search.filter_jobs)
and .csv (the scout's candidates). Moved out of boards.py as is (8 Nov 2026, ps E1: the file's 500-line limit)."""
import csv
import json
import os
from html import escape


def render(report):
    cards=[]
    for c in report['companies']:
        locations=sorted({j['city'] for j in c['jobs']});modes=sorted({j['work_mode'] for j in c['jobs']})
        links=([('Website',c['website'])] if c['website'] else [])+[(f'Careers {i+1}',u) for i,u in enumerate(c['career_pages'])]+[(a['platform'],a['url']) for a in c['platforms']]
        linkhtml=' · '.join(f'<a href="{escape(u,quote=True)}" target="_blank" rel="noopener">{escape(label)}</a>' for label,u in links)
        jobhtml=''.join(f'<li><a href="{escape(j["url"],quote=True)}">{escape(j["title"])}</a> — {escape(j["location"])} · {escape(j["work_mode"])} · {escape(j["source"])}</li>' for j in c['jobs'])
        hay=' '.join([c['company']]+locations+modes+[j['title'] for j in c['jobs']])
        cards.append(f'<article data-search="{escape(hay.lower(),quote=True)}"><h2>{escape(c["company"])}</h2><p>{escape(", ".join(locations))} · Size: {escape(c["size"])}</p><p>{linkhtml}</p><ul>{jobhtml}</ul><small>{escape("; ".join(c["notes"]))}</small></article>')
    status=''.join(f'<li>{escape(s["source"])}: {escape(s["status"])}</li>' for s in report['sources'])
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swiss software employers</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 20px;background:#f4f6fa;color:#182537}article{background:white;padding:20px;margin:16px 0;border:1px solid #dbe1e8;border-radius:12px}a{color:#165bba}li{margin:10px 0}input{font:inherit;padding:12px;width:90%}small{color:#576579}button{padding:8px;margin:8px 4px} [hidden]{display:none}</style><h1>Swiss software employers</h1>'''+f'<p>{len(cards)} companies · Checked {escape(report["checked_at"])}</p><p>Board-listed vacancies; official job availability is not independently confirmed. City refers to the job, not headquarters. Remote eligibility must be checked. Company size is retained when published; unknown sizes are included. No applicant-count or competition claims.</p><input id="q" aria-label="Filter companies" placeholder="City, company, remote, SRE…"><div>'+''.join(f'<button type="button" data-value="{v}">{v or "All"}</button>' for v in ['', 'Zurich','Geneva','Lausanne','Remote','Hybrid','SRE'])+'</div><p id="count"></p>'+''.join(cards)+'<h2>Discovery coverage</h2><ul>'+status+'</ul><script>const q=document.querySelector("#q");function filter(){let n=0;document.querySelectorAll("article").forEach(a=>{a.hidden=!a.dataset.search.includes(q.value.toLowerCase());if(!a.hidden)n++});document.querySelector("#count").textContent=n+" companies shown"}q.addEventListener("input",filter);document.querySelectorAll("button").forEach(b=>b.onclick=()=>{q.value=b.dataset.value;filter()});filter()</script></html>'


def write(report, out):
    """The report's three files in `out` (the reports folder); the JSON is written whole, then renamed."""
    out.mkdir(exist_ok=True)
    (out/'companies.html').write_text(render(report))
    # Why (8 Nov 2026, ps E1): written whole, then renamed: a search that runs this beside it (src/sources/boards_beside.py) imports the file
    (tmp:=out/'companies.json.tmp').write_text(json.dumps(report,ensure_ascii=False,indent=2));os.replace(tmp,out/'companies.json')
    with (out/'companies.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['company','size','cities','work_modes','website','career_pages','platforms','evidence_urls','notes'])
        for c in report['companies']:w.writerow([c['company'],c['size'],'; '.join(sorted({j['city'] for j in c['jobs']})),'; '.join(sorted({j['work_mode'] for j in c['jobs']})),c['website'],'; '.join(c['career_pages']),'; '.join(sorted({a['platform'] for a in c['platforms']})),'; '.join(j['url'] for j in c['jobs']),'; '.join(c['notes'])])
