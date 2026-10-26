# Usage: <venv>/Scripts/python.exe -I run_python.py <out.json>
# Measures how Python libraries/frameworks expose repeated query keys and cross-name order.
import sys, json, threading, socket, time, http.client, importlib.metadata as md
from urllib.parse import parse_qs, parse_qsl

OUT = sys.argv[1]
REP = {"ab": "q=a&q=b", "ba": "q=b&q=a"}
CROSS = {"ab": "a=1&b=2", "ba": "b=2&a=1"}


def ver(n):
    try:
        return md.version(n)
    except Exception:
        return "?"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def fetch(port, qs, path="/"):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request("GET", path + "?" + qs)
    r = c.getresponse()
    body = r.read().decode()
    c.close()
    try:
        return json.loads(body)
    except Exception:
        return {"error": "non-json", "status": r.status, "body": body[:200]}


libs = []  # dicts: lib, version, transport, single_accessor, all_accessor, fn(qs)->dict
closers = []


def add(lib, version, transport, sa, aa, fn):
    libs.append(dict(lib=lib, version=version, transport=transport, single_accessor=sa, all_accessor=aa, fn=fn))


# ---- in-process stdlib ----
add("Python urllib.parse.parse_qs", "stdlib " + sys.version.split()[0], "in-process",
    "n/a (values are always lists)", "parse_qs(qs)['q']",
    lambda qs: {"single": "n/a", "all": parse_qs(qs).get("q"), "keys": list(parse_qs(qs).keys())})
add("Python urllib.parse.parse_qsl", "stdlib " + sys.version.split()[0], "in-process",
    "dict(parse_qsl(qs))['q'] (common idiom, not a parse_qsl accessor)", "[v for k,v in parse_qsl(qs) if k=='q']",
    lambda qs: {"single": dict(parse_qsl(qs)).get("q"),
                "all": [v for k, v in parse_qsl(qs) if k == "q"],
                "keys": [k for k, v in parse_qsl(qs)]})

# ---- Django QueryDict in-process ----
import django
from django.conf import settings
settings.configure(DEBUG=False, SECRET_KEY="x", ALLOWED_HOSTS=["*"], ROOT_URLCONF="__main__")
django.setup()
from django.http import QueryDict, JsonResponse
from django.urls import path as dpath


def dj_inproc(qs):
    d = QueryDict(qs)
    return {"single": d.get("q"), "all": d.getlist("q"), "keys": list(d.keys())}


add("Django QueryDict (in-process)", ver("Django"), "in-process", ".get('q')", ".getlist('q')", dj_inproc)


def dj_view(request):
    g = request.GET
    return JsonResponse({"single": g.get("q"), "all": g.getlist("q"), "keys": list(g.keys())})


urlpatterns = [dpath("", dj_view)]
from wsgiref.simple_server import make_server, WSGIRequestHandler


class Quiet(WSGIRequestHandler):
    def log_message(self, *a, **k):
        pass


from django.core.wsgi import get_wsgi_application
dj_srv = make_server("127.0.0.1", 0, get_wsgi_application(), handler_class=Quiet)
threading.Thread(target=dj_srv.serve_forever, daemon=True).start()
closers.append(dj_srv.shutdown)
dj_port = dj_srv.server_address[1]
add("Django request.GET (real HTTP, wsgiref)", ver("Django"), "real-http", "request.GET.get('q')", "request.GET.getlist('q')",
    lambda qs: fetch(dj_port, qs))

# ---- Flask / werkzeug ----
from flask import Flask, request as frequest, jsonify
from werkzeug.serving import make_server as wz_make_server

fapp = Flask("m")


@fapp.route("/")
def f_index():
    a = frequest.args
    return jsonify(single=a.get("q"), all=a.getlist("q"), keys=list(a.keys()))


fsrv = wz_make_server("127.0.0.1", 0, fapp, threaded=True)
threading.Thread(target=fsrv.serve_forever, daemon=True).start()
closers.append(fsrv.shutdown)
fport = fsrv.server_address[1]
add("Flask/Werkzeug request.args", "Flask " + ver("Flask") + " / Werkzeug " + ver("Werkzeug"), "real-http",
    "request.args.get('q')", "request.args.getlist('q')", lambda qs: fetch(fport, qs))

# ---- Starlette + FastAPI via uvicorn ----
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route


async def st_index(request):
    p = request.query_params
    return JSONResponse({"single": p.get("q"), "all": p.getlist("q"), "keys": list(p.keys())})


st_app = Starlette(routes=[Route("/", st_index)])

from fastapi import FastAPI, Query, Request as FRequest
from typing import List, Optional

fa = FastAPI()


@fa.get("/scalar")
async def fa_scalar(request: FRequest, q: Optional[str] = None):
    return {"single": q, "all": "n/a", "keys": list(request.query_params.keys())}


@fa.get("/list")
async def fa_list(q: List[str] = Query(default=[])):
    return {"single": "n/a", "all": q, "keys": []}


def serve_uvicorn(app):
    port = free_port()
    cfg = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    srv = uvicorn.Server(cfg)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.1)
    closers.append(lambda: setattr(srv, "should_exit", True))
    return port


st_port = serve_uvicorn(st_app)
add("Starlette request.query_params", "Starlette " + ver("starlette"), "real-http",
    "query_params.get('q')", "query_params.getlist('q')", lambda qs: fetch(st_port, qs))
fa_port = serve_uvicorn(fa)
add("FastAPI scalar param `q: str`", "FastAPI " + ver("fastapi"), "real-http",
    "function arg q: str", "n/a (see next row)", lambda qs: fetch(fa_port, qs, "/scalar"))
add("FastAPI list param `q: List[str]`", "FastAPI " + ver("fastapi"), "real-http",
    "n/a (see previous row)", "function arg q: List[str]",
    lambda qs: {**fetch(fa_port, qs, "/list"), "keys": fetch(fa_port, qs, "/scalar").get("keys")})

# ---- aiohttp ----
import asyncio
from aiohttp import web

aio_port = free_port()


def start_aiohttp():
    async def h(request):
        qq = request.query
        return web.json_response({"single": qq.get("q"), "all": qq.getall("q", []), "keys": list(qq.keys())})

    async def main():
        app = web.Application()
        app.router.add_get("/", h)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", aio_port)
        await site.start()
        await asyncio.Event().wait()

    asyncio.run(main())


threading.Thread(target=start_aiohttp, daemon=True).start()

# ---- Tornado ----
import tornado.web, tornado.ioloop, tornado.httpserver, tornado.netutil

tor_port = free_port()


def start_tornado():
    import asyncio as aio
    loop = aio.new_event_loop()
    aio.set_event_loop(loop)

    class H(tornado.web.RequestHandler):
        def get(self):
            self.write({"single": self.get_query_argument("q", None),
                        "all": self.get_query_arguments("q"),
                        "keys": list(self.request.query_arguments.keys())})

    app = tornado.web.Application([(r"/", H)])
    app.listen(tor_port, address="127.0.0.1")
    loop.run_forever()


threading.Thread(target=start_tornado, daemon=True).start()

# ---- Bottle ----
import bottle

bapp = bottle.Bottle()


@bapp.route("/")
def b_index():
    qq = bottle.request.query
    return {"single": qq.get("q"), "all": qq.getall("q"), "keys": list(qq.keys())}


bsrv = make_server("127.0.0.1", 0, bapp, handler_class=Quiet)
threading.Thread(target=bsrv.serve_forever, daemon=True).start()
closers.append(bsrv.shutdown)
b_port = bsrv.server_address[1]

time.sleep(1.5)
add("aiohttp request.query", "aiohttp " + ver("aiohttp"), "real-http", "query.get('q')", "query.getall('q')", lambda qs: fetch(aio_port, qs))
add("Tornado", "Tornado " + ver("tornado"), "real-http", "get_query_argument('q')", "get_query_arguments('q')", lambda qs: fetch(tor_port, qs))
add("Bottle request.query", "Bottle " + ver("bottle"), "real-http", "request.query.get('q')", "request.query.getall('q')", lambda qs: fetch(b_port, qs))

out = []
for L in libs:
    r = {k: L[k] for k in ("lib", "version", "transport", "single_accessor", "all_accessor")}
    r["rep"] = {}
    r["cross"] = {}
    try:
        for k, v in REP.items():
            r["rep"][k] = {"qs": "?" + v, **L["fn"](v)}
        for k, v in CROSS.items():
            r["cross"][k] = {"qs": "?" + v, "keys": L["fn"](v).get("keys")}
    except Exception as e:
        r["error"] = repr(e)
    out.append(r)

json.dump(out, open(OUT, "w"), indent=2)
for o in out:
    if "error" in o:
        print(o["lib"], "ERROR", o["error"])
    else:
        print(o["lib"], "|", o["rep"]["ab"].get("single"), o["rep"]["ba"].get("single"), "|", o["rep"]["ab"].get("all"), o["rep"]["ba"].get("all"), "|", o["cross"]["ab"]["keys"], o["cross"]["ba"]["keys"])
sys.stdout.flush()
import os
os._exit(0)
