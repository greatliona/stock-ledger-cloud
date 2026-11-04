import ast
import threading
import time
import unittest
from pathlib import Path
from contextvars import ContextVar
from types import SimpleNamespace as NS
from quote_job import QuoteJob

class QuoteJobTests(unittest.TestCase):
    def test_live_progress_then_result(self):
        gate=threading.Event()
        context=ContextVar('test',default=None)
        def fetch(*args):
            context.get()('request_snapshot')
            gate.wait(2)
            context.get()('headers_snapshot')
            return {'quotes':{'TEST':{'price':1}}}
        job=QuoteJob('one',fetch,[],{},context)
        try:
            for _ in range(100):
                if any(e['stage']=='request_snapshot' for e in job.snapshot()['trace']): break
                time.sleep(.005)
            self.assertEqual(job.snapshot()['phase'],'running')
            self.assertEqual(job.snapshot()['trace'][-1]['stage'],'request_snapshot')
        finally: gate.set()
        for _ in range(100):
            if 'phase' not in job.snapshot(): break
            time.sleep(.005)
        self.assertEqual(job.snapshot()['quotes']['TEST']['price'],1)
        self.assertEqual(job.snapshot()['trace'][-1]['stage'],'backend_complete')

    def test_internal_error_does_not_leak_exception_message(self):
        context=ContextVar('test',default=None)
        def fetch(*args): raise RuntimeError('SECRET')
        job=QuoteJob('two',fetch,[],{},context)
        for _ in range(100):
            if 'phase' not in job.snapshot(): break
            time.sleep(.005)
        self.assertNotIn('SECRET',str(job.snapshot()))
        self.assertIn('RuntimeError',job.snapshot()['error'])

    def test_fragment_deduplicates_and_rejects_overlapping_job(self):
        method=next(n for n in ast.parse(Path(__file__).with_name('streamlit_app.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='render_ledger')
        method.decorator_list=[]
        request={'id':'one','symbols':['TEST']}
        replies=[]; jobs=[]
        class FakeJob:
            def __init__(self,identifier,*args): self.id=identifier; jobs.append(self)
            def snapshot(self): return {'id':self.id,'phase':'running'}
        def component(**kw): replies.append(kw['reply']); return request
        st=NS(session_state={'ledger_html':'test'},secrets={},components=NS(v1=NS(declare_component=lambda *a,**k:component)))
        ns=dict(st=st,ROOT=Path('.'),QuoteJob=FakeJob,quote_backend=NS(fetch_us_quotes=None,QUOTE_PROGRESS=None))
        exec(compile(ast.Module(body=[method],type_ignores=[]),'test','exec'),ns)
        run=ns['render_ledger']
        run(); run()
        self.assertEqual(len(jobs),1)
        self.assertEqual(replies[-1]['phase'],'running')
        request={'id':'two','symbols':['TEST']}
        run(); run()
        self.assertEqual(len(jobs),1)
        self.assertEqual(replies[-1]['id'],'two')
        self.assertIn('未重複',replies[-1]['error'])

if __name__=='__main__': unittest.main()
