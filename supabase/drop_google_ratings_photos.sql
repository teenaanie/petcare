-- supabase/drop_google_ratings_photos.sql
--
-- Applied as migration `drop_google_ratings_and_photos`.
--
-- WHY. 882 rows displayed Google's star rating and review count, and 841 rows
-- hotlinked images from Google's CDN. All of it came from an Apify scrape of
-- Google Maps, not from the Maps API, so there was no licence to republish any
-- of it. Three separate problems in one:
--
--   · Ratings and review counts are Google's content, shown in Pippy as though
--     Pippy had measured them.
--   · The image URLs are hotlinks into googleusercontent. Somebody else's
--     copyright, every visitor's IP handed to Google on page load, and links
--     that expire — which would eventually have filled the directory with
--     broken images regardless of anyone's terms.
--   · Neither carried any attribution.
--
-- WHAT IS KEPT. Name, address, phone, area, categories and maps_url: factual
-- contact details, and a link that sends people TO Google rather than copying
-- from it. A pet parent can still see the rating — on Google, where it lives.
--
-- The COLUMNS are kept, only the scraped VALUES cleared. A business that
-- registers itself supplies its own photo through the registration form and
-- that is legitimate, so the three manually-added rows keep theirs.
--
-- NOT TOUCHED: feedback.rating is a user's own 1-5 star rating of Pippy. It has
-- nothing to do with Google and is unrelated to providers.rating despite the
-- shared column name.

UPDATE public.providers
SET rating = NULL, reviews_count = NULL
WHERE rating IS NOT NULL OR reviews_count IS NOT NULL;

UPDATE public.providers
SET photo_url = NULL
WHERE source = 'google_maps' AND photo_url IS NOT NULL;

-- search_providers was also redefined to drop `rating DESC` from its ORDER BY.
-- Every value is NULL now, so it sorted nothing, and leaving it there would
-- imply a ranking signal that no longer exists. Ordering is: name matches
-- first when there is a search term, then area, then name. The full body lives
-- in provider_search_fuzzy.sql; only the ORDER BY changed.
--
-- After, measured:
--   google_maps  973 rows   0 ratings   0 review counts   0 photos
--   manual         3 rows   0 ratings   0 review counts   3 photos (own)
--   search 'border' still returns 136
--   feedback.rating untouched
