# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    python3-dev \
    swig \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install setuptools wheel

# Install pjsua2
WORKDIR /tmp
RUN git clone https://github.com/pjsip/pjproject.git \
    && cd pjproject \
    && sed -i 's/-svn//' version.mak \
    && sed -i 's/PJ_VERSION_SUFFIX := -dev/PJ_VERSION_SUFFIX := dev/' version.mak \
    && export CFLAGS="-fPIC" \
    && ./configure --prefix=/usr --enable-shared \
    && make dep \
    && make \
    && make install \
    && cd pjsip-apps/src/swig/python \
    && make \
    && make install

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose the ports the app runs on
EXPOSE 5060
EXPOSE 8080

# Command to run the application with unbuffered output
# -u flag ensures stdout/stderr are unbuffered for real-time logging
CMD ["python", "-u", "main.py"]
