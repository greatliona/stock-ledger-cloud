"""Per-session diagnostic worker; history never contains credentials or prices."""
import threading
import time

class QuoteJob:
    def __init__(self, identifier, fetch, symbols, config, progress_context):
        self.id = identifier
        self.started = time.monotonic()
        self.lock = threading.Lock()
        self.events = []
        self.result = None
        self.emit('backend_received')
        def work():
            token = progress_context.set(self.emit)
            try:
                self.emit('credentials_check')
                result = fetch(symbols, config)
            except ValueError as error:
                result = {'quotes': {}, 'errors': {}, 'error': str(error)}
            except Exception as error:
                result = {'quotes': {}, 'errors': {}, 'error': '後端內部錯誤：' + type(error).__name__}
            finally:
                progress_context.reset(token)
            self.emit('backend_complete')
            with self.lock:
                self.result = result
        threading.Thread(target=work, daemon=True, name='quote-diagnostic').start()

    def emit(self, stage):
        with self.lock:
            self.events.append({'stage': stage, 'seconds': round(time.monotonic()-self.started, 2)})
            self.events = self.events[-80:]

    def snapshot(self):
        with self.lock:
            info = {'id': self.id, 'trace': list(self.events),
                    'backendSeconds': round(time.monotonic()-self.started, 2)}
            if self.result is None:
                return {**info, 'phase': 'running'}
            return {**self.result, **info}
