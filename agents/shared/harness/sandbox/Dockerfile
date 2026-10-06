FROM mcr.microsoft.com/playwright/python:v1.60.0-noble
RUN pip install --no-cache-dir playwright==1.60.0
COPY runner.py /opt/qa/runner.py
COPY live_runner.py /opt/qa/live_runner.py
USER pwuser
WORKDIR /tmp
ENTRYPOINT ["python3", "-I", "/opt/qa/runner.py"]
