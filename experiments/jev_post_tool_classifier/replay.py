#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
KEY_FILE = Path.home() / ".config/typesafe/api_key"

OPTIONS = {
    "TRANSIENT": "Temporary transport, network, provider, or resource failure; retrying later without changing source/config may reasonably succeed.",
    "ENVIRONMENT": "Local runtime, service, dependency, machine, or deployment state is wrong/unavailable and must be repaired or started before retrying.",
    "CODE_BUG": "The evidence directly indicates a defect in program implementation that should be returned to a coding worker for a source change.",
    "PERMISSION": "Authentication, authorization, filesystem permission, credential, or access policy denied the operation.",
    "USER_ERROR": "The tool/request was invoked incorrectly: wrong path, wrong offset, wrong object type, malformed or otherwise invalid invocation. Correct the request rather than edit source.",
    "UNKNOWN": "The observed evidence is too generic or incomplete to safely choose another recovery class.",
}

# Every item below is a faithful minimal condensation of a real local log event.
# Provenance is retained locally; it is not sent to Jev. Gold is also local-only.
CASES = [
    {"id":"U01","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-08-28T12:39:55Z","state":{"tool":"read","success":False,"error":"Offset 360 is beyond end of file (306 lines total)"}},
    {"id":"U02","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-09-10T15:00:15Z","state":{"tool":"read","success":False,"error":"Offset 401 is beyond end of file (84 lines total)"}},
    {"id":"U03","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-09-13T05:19:59Z","state":{"tool":"read","success":False,"error":"Offset 80 is beyond end of file (71 lines total)"}},
    {"id":"U04","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-09-04T13:08:40Z","state":{"tool":"read","success":False,"requested_path":"export_transcript.py","error":"ENOENT: no such file or directory"}},
    {"id":"U05","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-09-12T09:21:44Z","state":{"tool":"read","success":False,"requested_path":"src/personal_content_distiller/policy/distillation-policy-v2.md","error":"ENOENT: no such file or directory"}},
    {"id":"U06","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-09-13T10:54:36Z","state":{"tool":"read","success":False,"requested_path":"tests","error":"EISDIR: illegal operation on a directory, read"}},
    {"id":"U07","gold":"USER_ERROR","provenance":"launchagent.stderr.log:2026-09-15T09:17:49Z","state":{"tool":"read","success":False,"requested_path":"AGENTS.md","error":"ENOENT: no such file or directory"}},

    {"id":"T01","gold":"TRANSIENT","provenance":"cloudflared.stderr.log:2026-09-17T07:24:34Z","state":{"component":"cloudflared tunnel","error":"write udp6: sendmsg: no buffer space available"}},
    {"id":"T02","gold":"TRANSIENT","provenance":"cloudflared.stderr.log:2026-09-17T18:15:30Z","state":{"component":"cloudflared tunnel","error":"datagram manager error: timeout: no recent network activity"}},
    {"id":"T03","gold":"TRANSIENT","provenance":"cloudflared.stderr.log:2026-09-17T20:31:49Z","state":{"component":"cloudflared tunnel","error":"datagram manager error: timeout: no recent network activity"}},
    {"id":"T04","gold":"TRANSIENT","provenance":"cloudflared.stderr.log:2026-09-18T05:24:36Z","state":{"component":"cloudflared tunnel","error":"write udp: sendmsg: no buffer space available"}},
    {"id":"T05","gold":"TRANSIENT","provenance":"cloudflared.stderr.log:2026-09-18T21:45:18Z","state":{"component":"cloudflared tunnel","error":"sendmsg: no route to host; timeout: no recent network activity"}},

    {"id":"E01","gold":"ENVIRONMENT","provenance":"cloudflared.stderr.log:2026-09-17T00:33:40Z","state":{"component":"cloudflared origin proxy","precheck":"DNS, UDP, TCP, and Cloudflare API healthy","error":"Unable to reach the origin service: dial tcp 127.0.0.1:17676: connect: connection refused"}},

    {"id":"B01","gold":"CODE_BUG","provenance":"launchagent.stderr.log:historical repeated runtime validation","state":{"component":"DevSpace HTTP runtime","error_code":"ERR_ERL_PERMISSIVE_TRUST_PROXY","error":"Express trust proxy is true, allowing IP-based rate limiting to be bypassed","context":"runtime validation rejects the application's proxy configuration"}},

    {"id":"X01","gold":"UNKNOWN","provenance":"agentd.log:2026-09-13T20:00:08Z","state":{"component":"local agent","provider":"codex","error_code":"PROVIDER_EXECUTION_ERROR","error":"Codex agent turn failed.","cause_type":"object","persistence_failed":False}},
    {"id":"X02","gold":"UNKNOWN","provenance":"agentd.log:2026-09-16T13:41:59Z","state":{"component":"local agent","provider":"claude","error_code":"PROVIDER_EXECUTION_ERROR","error":"Claude agent turn failed.","cause_type":"Error","persistence_failed":False}},
]

def build_payload():
    state = {c["id"]: c["state"] for c in CASES}
    questions = {}
    for c in CASES:
        questions[c["id"]] = {
            "type":"choice",
            "instructions": (
                f"Classify state.{c['id']} for the next recovery action. Use only the observed evidence. "
                "Choose UNKNOWN when the evidence does not establish a safe recovery class."
            ),
            "criteria": OPTIONS,
        }
    return {"model":MODEL,"state":{"incidents":state},"questions":questions}

def call(api_key: str):
    payload = build_payload()
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json"},
        method="POST",
    )
    start=time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as resp:
        body=json.loads(resp.read())
        rid=resp.headers.get("x-typesafe-request-id")
    latency=(time.perf_counter()-start)*1000
    out={}
    for c in CASES:
        a=body["answers"].get(c["id"],{})
        out[c["id"]]={"choice":a.get("choice"),"confidence":a.get("confidence"),"probabilities":a.get("probabilities")}
    return out,{"request_id":rid,"latency_ms":round(latency,3),"resolved_model":body.get("model"),"usage":body.get("usage")}

def summarize(runs):
    meta={c["id"]:c for c in CASES}
    rows=[]
    per_case={c["id"]:[] for c in CASES}
    for ri,run in enumerate(runs,1):
        for cid,a in run["answers"].items():
            per_case[cid].append(a)
            rows.append((meta[cid],a))

    exact=sum(a["choice"]==c["gold"] for c,a in rows)
    unsafe_retry=sum(c["gold"]!="TRANSIENT" and a["choice"]=="TRANSIENT" for c,a in rows)
    bad_source_edit=sum(c["gold"]!="CODE_BUG" and a["choice"]=="CODE_BUG" for c,a in rows)
    missed_transient=sum(c["gold"]=="TRANSIENT" and a["choice"]!="TRANSIENT" for c,a in rows)
    unknown=sum(a["choice"]=="UNKNOWN" for _,a in rows)
    by_gold={}
    for gold in OPTIONS:
        rr=[(c,a) for c,a in rows if c["gold"]==gold]
        if rr:
            by_gold[gold]={
                "evaluations":len(rr),
                "exact":sum(a["choice"]==gold for _,a in rr),
                "choices":{o:sum(a["choice"]==o for _,a in rr) for o in OPTIONS},
            }
    cases={}
    for cid,answers in per_case.items():
        conf=[float(a["confidence"]) for a in answers if isinstance(a.get("confidence"),(int,float))]
        cases[cid]={
            "gold":meta[cid]["gold"],
            "provenance":meta[cid]["provenance"],
            "choice_counts":{o:sum(a["choice"]==o for a in answers) for o in OPTIONS},
            "confidence_mean":statistics.mean(conf) if conf else None,
            "confidence_min":min(conf) if conf else None,
            "confidence_max":max(conf) if conf else None,
        }
    n=len(rows)
    return {
        "independent_cases":len(CASES),
        "evaluations":n,
        "exact_accuracy":exact/n,
        "unsafe_auto_retry_count":unsafe_retry,
        "unsafe_auto_retry_rate":unsafe_retry/n,
        "unnecessary_source_edit_count":bad_source_edit,
        "unnecessary_source_edit_rate":bad_source_edit/n,
        "missed_transient_count":missed_transient,
        "unknown_escalation_count":unknown,
        "unknown_escalation_rate":unknown/n,
        "by_gold":by_gold,
        "cases":cases,
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--repeats",type=int,default=10)
    ap.add_argument("--output",type=Path,required=True)
    args=ap.parse_args()
    key=KEY_FILE.read_text().strip()
    runs=[]
    for i in range(args.repeats):
        answers,metadata=call(key)
        runs.append({"answers":answers,"metadata":metadata})
        print(f"run {i+1}/{args.repeats} {metadata['latency_ms']:.0f}ms",flush=True)
        time.sleep(.1)
    report={
        "schema":"devspace-jev-post-tool-replay-v1",
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "model_requested":MODEL,
        "gold_labels_sent_to_model":False,
        "permission_gold_cases":0,
        "cases":[{"id":c["id"],"gold":c["gold"],"provenance":c["provenance"]} for c in CASES],
        "summary":summarize(runs),
        "raw_runs":runs,
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(args.output)

if __name__=="__main__": main()
