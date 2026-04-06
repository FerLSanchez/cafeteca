from flask import Blueprint, jsonify
from db import db_conn
from schema import login_required

bp = Blueprint('stats', __name__)


@bp.route('/api/stats')
@login_required
def stats():
    with db_conn() as conn:
        total    = conn.execute('SELECT COUNT(*) FROM coffees').fetchone()[0]
        finished = conn.execute("SELECT COUNT(*) FROM coffees WHERE finished_date IS NOT NULL AND finished_date!=''").fetchone()[0]
        active   = conn.execute("SELECT COUNT(*) FROM coffees WHERE opened_date IS NOT NULL AND opened_date!='' AND (finished_date IS NULL OR finished_date='')").fetchone()[0]
        pending_weight_g = conn.execute(
            "SELECT COALESCE(SUM(quantity_g),0) FROM coffees WHERE (opened_date IS NULL OR opened_date='') AND (finished_date IS NULL OR finished_date='')"
        ).fetchone()[0]
        active_weight_g = conn.execute(
            "SELECT COALESCE(SUM(remaining_g),0) FROM coffees WHERE opened_date IS NOT NULL AND opened_date!='' AND (finished_date IS NULL OR finished_date='')"
        ).fetchone()[0]
        avg_r    = conn.execute('SELECT AVG(rating) FROM coffees WHERE rating IS NOT NULL').fetchone()[0]
        spent    = conn.execute('SELECT SUM(quantity_g/1000.0*price_kg) FROM coffees WHERE price_kg IS NOT NULL AND quantity_g IS NOT NULL').fetchone()[0]
        avg_cost_kg = conn.execute('''
            SELECT SUM(quantity_g/1000.0*price_kg) / NULLIF(SUM(quantity_g/1000.0), 0)
            FROM coffees WHERE price_kg IS NOT NULL AND quantity_g IS NOT NULL AND quantity_g > 0
        ''').fetchone()[0]
        days_per_kg = conn.execute('''
            SELECT AVG((julianday(finished_date) - julianday(opened_date)) / (quantity_g / 1000.0))
            FROM coffees
            WHERE finished_date IS NOT NULL AND finished_date != ''
              AND opened_date   IS NOT NULL AND opened_date   != ''
              AND quantity_g    IS NOT NULL AND quantity_g    > 0
        ''').fetchone()[0]
        top_roasters = conn.execute('''
            SELECT ro.name, COUNT(*) cnt, AVG(c.rating) avg_rating
            FROM coffees c JOIN roasters ro ON c.roaster_id=ro.id
            GROUP BY ro.id ORDER BY avg_rating DESC NULLS LAST, cnt DESC LIMIT 5''').fetchall()
        origins_bd = conn.execute('''
            SELECT o.name, COUNT(*) cnt, AVG(c.rating) avg_rating
            FROM coffees c JOIN origins o ON c.origin_id=o.id
            GROUP BY o.id ORDER BY avg_rating DESC NULLS LAST, cnt DESC LIMIT 8''').fetchall()
        processes_bd = conn.execute('''
            SELECT pr.name, COUNT(DISTINCT cp.coffee_id) cnt, AVG(c.rating) avg_rating
            FROM coffee_processes cp
            JOIN processes pr ON cp.process_id=pr.id
            JOIN coffees c ON cp.coffee_id=c.id
            GROUP BY pr.id ORDER BY avg_rating DESC NULLS LAST, cnt DESC LIMIT 6''').fetchall()
        varieties_bd = conn.execute('''
            SELECT v.name, COUNT(DISTINCT cv.coffee_id) cnt, AVG(c.rating) avg_rating
            FROM coffee_varieties cv
            JOIN varieties v ON cv.variety_id=v.id
            JOIN coffees c ON cv.coffee_id=c.id
            GROUP BY v.id ORDER BY avg_rating DESC NULLS LAST, cnt DESC LIMIT 6''').fetchall()
    return jsonify({
        'total': total, 'finished': finished, 'active': active,
        'pending_weight_g': pending_weight_g,
        'active_weight_g': active_weight_g,
        'avg_rating': round(avg_r, 1) if avg_r else None,
        'total_spent': round(spent, 2) if spent else 0,
        'avg_cost_kg': round(avg_cost_kg, 2) if avg_cost_kg else None,
        'days_per_kg': round(days_per_kg, 1) if days_per_kg else None,
        'top_roasters': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in top_roasters],
        'origins_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in origins_bd],
        'processes_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in processes_bd],
        'varieties_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in varieties_bd],
    })
