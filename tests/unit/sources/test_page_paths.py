"""The path recipe (src/sources/page_paths.py, page_recipes kind 'path'): a job link found by the tags and classes above it, learned from the AI's own job list, replayed
on the page and on another page of the board; a path that matches too much reads nothing. Offline, no AI. Measured 13 Nov 2026 on the 58 saved board pages (PR body)."""
import json
import re
import shutil
import subprocess
import unittest

from src.sources import page_paths, page_recipes

BASE = 'https://board.example/search?q=driver'


def card(n, title='Fahrer', cls='job'):
    return f'<li class="{cls}"><a class="title-link" href="/o/{n}"><h4>{title} {n}</h4><p>Berlin</p></a></li>'


def listing(count, noise=True):
    extra = '<li class="job"><a href="/about">About us</a></li>' if noise else ''   # a sibling that is not a job: the chain must tell it apart by its link's class
    return f'<ul class="results">{"".join(card(n) for n in range(count))}</ul>{extra}'


def jobs(count):
    return [{'title': f'Fahrer {n}', 'url': f'https://board.example/o/{n}'} for n in range(count)]


class PathRecipe(unittest.TestCase):
    def test_a_path_is_learned_from_the_ais_jobs_and_reads_them_again(self):
        recipe = page_recipes._path(listing(6), BASE, [j['title'] for j in jobs(6)], [j['url'] for j in jobs(6)])
        self.assertEqual(recipe['kind'], 'path')
        self.assertTrue(page_recipes.valid(recipe))
        got = page_recipes.replay(recipe, listing(6), BASE)
        self.assertEqual([url for _, url in got], [f'https://board.example/o/{n}' for n in range(6)], 'the job links, never the noise link')
        self.assertEqual(recipe['chain'][-1], ['a', 'title-link'], 'the link\'s own class tells a job link from the about link')

    def test_it_reads_another_page_of_the_board_with_more_jobs(self):
        """Why (13 Nov 2026, sa): a recipe learned on a 5-job page must read the board's 20-job page; 3x alone refused 10 of 103 correct cross-page reads."""
        recipe = page_recipes._path(listing(3), BASE, [j['title'] for j in jobs(3)], [j['url'] for j in jobs(3)])
        self.assertEqual(recipe['max'], 9)
        self.assertEqual(len(page_recipes.replay(recipe, listing(20), BASE)), 20)

    def test_a_page_of_a_hundred_real_jobs_is_read_though_the_recipe_was_learned_on_three(self):
        """Why (13 Nov 2026, sa: "a page of 50 or 100 real job links is common"): past 3x the learned jobs the matches must be one URL shape, not a fixed page size."""
        recipe = page_recipes._path(listing(3), BASE, [j['title'] for j in jobs(3)], [j['url'] for j in jobs(3)])
        self.assertEqual(len(page_recipes.replay(recipe, listing(100), BASE)), 100)

    def test_a_path_that_grabs_menus_and_footers_with_the_jobs_reads_nothing_never_a_trimmed_list(self):
        recipe = {'kind': 'path', 'chain': [['li', ''], ['a', '']], 'max': 9}   # any list item's link: the learn page had only job items
        menu = ''.join(f'<li><a href="/{name}">{name} page</a></li>' for name in ('about', 'contact', 'login', 'press', 'blog', 'help', 'faq', 'terms', 'privacy', 'careers'))
        grabbed = f'<ul>{menu}{"".join(f"<li><a href=/o/{n}>Fahrer {n}</a></li>" for n in range(5))}</ul>'
        self.assertEqual(page_recipes.replay(recipe, grabbed, BASE), [], '15 links past the cap, ten of them one-segment pages: not a job list')
        self.assertEqual(len(page_recipes.replay(recipe, f'<ul>{"".join(f"<li><a href=/o/{n}>Fahrer {n}</a></li>" for n in range(5))}</ul>', BASE)), 5, 'positive control: under the cap it reads')

    def test_a_heading_inside_the_link_is_a_title_when_the_link_text_is_a_whole_card(self):
        whole = ''.join(f'<article class="card"><a href="/o/{n}"><h2>Fahrer {n}</h2>{"Lorem ipsum dolor sit amet " * 8}</a></article>' for n in range(5))
        recipe = page_recipes._path(whole, BASE, [j['title'] for j in jobs(5)], [j['url'] for j in jobs(5)])
        self.assertEqual(recipe['title'], 'h2')
        self.assertEqual([t for t, _ in page_recipes.replay(recipe, whole, BASE)], [f'Fahrer {n}' for n in range(5)])

    def test_attributes_of_other_names_are_not_classes_and_data_attributes_are_not_read(self):
        page = '<div class="job" data-class="x"><a href="/o/1" data-title="Tracking" class="t">Fahrer eins</a></div>'
        self.assertEqual(page_paths.anchors(page, BASE)[0].chain[1], ('div', ('job',)))
        self.assertEqual(page_paths.title_of(page_paths.anchors(page, BASE)[0], 'label'), '', 'data-title is not the link\'s name')

    def test_a_job_with_two_links_learns_from_the_one_that_reads_the_list(self):
        both = ''.join(f'<div class="card"><a href="/o/{n}">Fahrer {n}</a><a class="btn" href="/o/{n}">Apply</a></div>' for n in range(5))
        recipe = page_recipes._path(both, BASE, [j['title'] for j in jobs(5)], [j['url'] for j in jobs(5)])
        self.assertTrue(recipe and [t for t, _ in page_recipes.replay(recipe, both, BASE)] == [f'Fahrer {n}' for n in range(5)], recipe)

    def test_only_the_fixed_shape_is_valid(self):
        good = {'kind': 'path', 'chain': [['li', 'job'], ['a', 'title-link']], 'max': 9}
        self.assertTrue(page_recipes.valid(good))
        self.assertTrue(page_recipes.valid({**good, 'title': 'h4'}))
        for bad in ({**good, 'x': 1}, {**good, 'title': 'script'}, {**good, 'max': 0}, {**good, 'max': 1001}, {**good, 'chain': []},
                    {**good, 'chain': [['li', 'job']]}, {**good, 'chain': [['script', ''], ['a', '']]}, {**good, 'chain': [['li', 'a b'], ['a', '']]},
                    {**good, 'chain': [['div', 'x']] * 5 + [['a', '']]}, {**good, 'chain': [['li', '(a)+'], ['a', '']]}, {'kind': 'path', 'chain': good['chain']}):
            with self.subTest(bad=bad):
                self.assertFalse(page_recipes.valid(bad))

    def test_a_recipe_learned_before_paths_stays_the_one_learned(self):
        links = page_recipes.derive('<ul>' + ''.join(f'<li><a href="/jobs/{n}">Fahrer {n}</a></li>' for n in range(5)) + '</ul>', BASE,
                                    [{'title': f'Fahrer {n}', 'url': f'https://board.example/jobs/{n}'} for n in range(5)])
        self.assertEqual(links, {'kind': 'links', 'prefix': '/jobs'}, 'paths come last')

    def test_a_page_the_parser_cannot_read_has_no_path_recipe(self):
        self.assertEqual(page_paths.anchors('<a href="/o/1"', BASE), ())
        self.assertIsNone(page_recipes._path('<html', BASE, ['x'], ['https://board.example/o/1']))


if __name__ == '__main__':
    unittest.main()
