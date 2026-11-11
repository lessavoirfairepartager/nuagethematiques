import re, sys
from playwright.sync_api import sync_playwright

B = 'http://localhost:8899/'
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def page():
        ctx = br.new_context(viewport={'width': 1200, 'height': 900})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        return pg

    # Animateur : création
    a = page(); a.goto(B)
    a.click('summary'); a.click('#createForm button')
    a.wait_for_selector('#secAdminBar:not(.hidden)')
    code = re.search(r's=([A-Z2-9]{5})', a.url).group(1)
    assert 'k=' in a.url
    assert a.input_value('#linkPart').endswith('?s=' + code)

    # Trois participants
    phrases = [
        ("J'ai du mal à adapter les exercices au rythme de chacun.", ['Différenciation'], None),
        ("Les élèves décrochent quand je reprends les bases.", ['Différenciation', 'Gestion de classe'], None),
        ("Ils ne voient pas le lien avec leur métier <b>x</b>.", [], 'Lien avec le pro'),
    ]
    parts = []
    for text, themes, new in phrases:
        pg = page(); pg.goto(B + '?s=' + code); pg.wait_for_selector('#secForm:not(.hidden)')
        pg.fill('#fText', text)
        for t in themes: pg.click(f'#fChips label:has-text("{t}")')
        if new: pg.fill('#fNewTheme', new); pg.click('#fAddTheme')
        pg.click('#contribForm button:not([type=button])')
        pg.wait_for_selector('#mine .item')
        assert pg.locator('#mine .item').count() == 1          # ne voit que sa phrase
        assert pg.locator('#secAdminBar').is_hidden()
        parts.append(pg)
    # la saisie en cours ne doit pas être effacée par le rafraîchissement automatique
    parts[0].fill('#fText', 'brouillon en cours'); parts[0].wait_for_timeout(5000)
    assert parts[0].input_value('#fText') == 'brouillon en cours'
    assert '<b>' not in parts[2].inner_html('#mine p') or '&lt;b&gt;' in parts[2].inner_html('#mine p')  # échappement

    a.wait_for_timeout(3500)
    assert a.locator('#cloud .word').count() == 3, a.inner_html('#cloud')
    assert 'Différenciation' in a.locator('#cloud .word').nth(1).inner_text()  # le plus gros au centre
    a.click('#secManage summary'); assert a.locator('#allContribs .item').count() == 3
    a.screenshot(path='/home/claude/nuage/test/1-collecte-anim.png', full_page=True)
    parts[1].screenshot(path='/home/claude/nuage/test/1-collecte-part.png', full_page=True)

    # Phase besoins
    a.click('[data-phase=besoins]'); a.wait_for_selector('#secNeeds:not(.hidden)')
    assert 'Différenciation' in a.inner_text('#themeTitle')
    p0 = parts[0]; p0.wait_for_selector('#secNeeds:not(.hidden)', timeout=8000)
    assert p0.locator('#themePhrases li').count() == 2 and p0.locator('#secForm').is_hidden()
    p0.fill('#needText', 'Des supports à plusieurs niveaux prêts à l’emploi'); p0.click('#needForm button')
    a.fill('#needText', 'Une méthode pour gérer deux groupes en parallèle'); a.click('#needForm button')
    a.wait_for_timeout(3500); assert a.locator('#needs .item').count() == 2

    # Sondage
    a.click('[data-phase=vote]'); a.select_option('#maxVotes', '1'); a.wait_for_timeout(500)
    for pg in parts:
        pg.wait_for_selector('#secVote:not(.hidden)', timeout=8000); pg.wait_for_timeout(4500)
        pg.locator('#voteList input').first.check(); pg.wait_for_timeout(400)
        assert pg.locator('#secResults').is_hidden()
    parts[2].locator('#voteList input').nth(1).click()   # dépasse le maximum : refusé
    parts[2].wait_for_timeout(400); assert parts[2].locator('#voteList input:checked').count() == 1
    a.wait_for_timeout(3500)
    assert '3 votants' in a.inner_text('#resCount'), a.inner_text('#resCount')
    a.screenshot(path='/home/claude/nuage/test/3-vote-anim.png', full_page=True)

    # Bilan
    a.click('[data-phase=bilan]'); a.wait_for_selector('#objForm:not(.hidden)')
    a.click('#objFromNeed'); a.wait_for_timeout(3500)
    assert a.input_value('#objText') != ''          # texte non enregistré conservé malgré le rafraîchissement
    a.fill('#objText', 'Concevoir une séance à deux niveaux d’aide'); a.click('#objForm button:not([type=button])')
    p0.wait_for_selector('#objectiveView:not(.hidden)', timeout=8000)
    assert 'deux niveaux' in p0.inner_text('#objectiveView') and p0.locator('#results .bar').count() == 2
    p0.screenshot(path='/home/claude/nuage/test/4-bilan-part.png', full_page=True)
    a.click('#btnProj'); a.wait_for_timeout(500)
    a.screenshot(path='/home/claude/nuage/test/5-projection.png'); a.click('#projClose')

    # Export + iframe
    with a.expect_download() as d:
        a.click('#btnExport'); a.click('#exTxt')
    txt = open(d.value.path(), encoding='utf-8').read(); assert 'OBJECTIF DE TRAVAIL : Concevoir' in txt and 'Différenciation (2)' in txt
    a.click('#exClose')
    f = page(); f.set_content(a.input_value('#linkFrame')); fr = f.frame_locator('iframe')
    fr.locator('#objectiveView').wait_for(timeout=8000)

    # Code inconnu
    z = page(); z.goto(B + '?s=ZZZZZ'); z.wait_for_selector('#home:not(.hidden)')
    br.close()

real = [e for e in errors if '404' not in e]
print('Erreurs console :', real or 'aucune'); print(txt)
sys.exit(1 if real else 0)
