# Kendi sunucumuzda ses üretimi (VoxCPM2). Model ve ses örneği imaja gömülmez: ilk açılışta /veri birimine iner.
# Taban imaj küçük tutuldu: CUDA kitaplıkları torch'un pip paketiyle gelir (ayrı nvidia/cuda imajına gerek yok),
# ekran kartı sürücüsünü çalışma anında nvidia-container-toolkit bağlar. İmaj yaklaşık 7,5 GB'tır.
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/veri/hf SES_VERI=/veri \
    TORCHINDUCTOR_CACHE_DIR=/veri/derleme/inductor TRITON_CACHE_DIR=/veri/derleme/triton NUMBA_CACHE_DIR=/veri/derleme/numba \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    OMP_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false HF_HUB_DISABLE_TELEMETRY=1
# gcc/g++: torch.compile (triton) çekirdekleri derlerken C derleyicisi ister; yoksa hızlandırma devreye girmez
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt && pip install --no-deps voxcpm==2.0.3
COPY sunucu.py NOTICE ./
VOLUME /veri
EXPOSE 8000
CMD ["uvicorn", "sunucu:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
