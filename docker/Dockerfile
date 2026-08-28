FROM python:3.13-alpine

WORKDIR /app

COPY requirements/requirements.txt .
RUN apk add --no-cache tzdata && pip install --no-cache-dir -r requirements.txt

COPY py/nextep.py .
COPY static ./static

ENV PORT=8050
ENV DB_PATH=/app/data/nextep.db
ENV TZ=Europe/Istanbul

EXPOSE 8050

VOLUME /app/data

CMD ["python", "nextep.py"]