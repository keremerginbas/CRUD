FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY *.py ./
# Ses algılama (VAD) modelini imaja göm; çalışırken indirmesin
RUN python agent.py download-files
CMD ["python", "agent.py", "start"]
