FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt --no-cache-dir
COPY app.py db.py lookup_config.py models.py schema.py ./
COPY blueprints/ blueprints/
COPY templates/ templates/
COPY static/ static/
EXPOSE 5323
CMD ["gunicorn", "--workers=2", "--threads=4", "--preload", "--bind=0.0.0.0:5323", "app:app"]
