FROM public.ecr.aws/docker/library/python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY grader ./grader
# Compile SymPy ahead of time so the first request after a deploy does not pay for it.
RUN python -m compileall -q grader /usr/local/lib/python3.12/site-packages/sympy \
 && python -c "import grader.main"
USER nobody
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "grader.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
