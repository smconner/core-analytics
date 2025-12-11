#!/bin/bash
# ModelZero Analytics Ingestion Wrapper Script
# Ensures ingestion runs from correct directory with proper environment

cd /var/www/modelzero.com/core-analytics || exit 1
/usr/bin/node scripts/ingest-logs.js
