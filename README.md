Pantiler
========

Convert geographic data into vector map tiles.


Installing
----------

    $ npm install -g pantiler

Alternatively, don't install it and just prepend the command with `npx`.


Usage
-----

In the terminal:

    $ pantiler <tilefile> <directory>

The directory is where the tiles will be created, and should not already exist. Downloaded and processed files will be cached into a directory named `.pantiler-cache`, and can then be used to speed up subsequent runs. The cache can be automatically removed when Pantiler finishes successfully with `-c`.

The tiles are just static files that can then be hosted on S3, for example. They can then be rendered in the browser with [Mapbox GL](https://github.com/mapbox/mapbox-gl-js), or any other library that supports vector tiles. See `example.html` for what this looks like.

Pantiler can also be used as a library. To import it:

    import Pantiler from 'pantiler'

Then set it up:

    const pantiler = Pantiler(directory, cache, clearCache, alert)

Where:

* `directory` -- where the tiles will be created, should not already exist
* `cache` (optional) -- the name of a directory where files will be cached, defaults to `.pantiler-cache`
* `clearCache` (optional) -- whether the cache should be removed after running, boolean, defaults to false
* `alert` -- (optional) -- a function that will be called with informational messages as Pantiler runs, defaults to doing nothing

Then run it:

    await pantiler(tiledata)

Where `tiledata` is an object following the tilefile format, described below.


Tilefiles
---------

Tilefiles are written in Yaml or Json. There is an `example.yaml` included for reference.

* `host` -- the location the tiles will be served from
* `zoomFrom` -- the most zoomed-out level of tiles to generate
* `zoomTo` -- the most zoomed-in level of tiles to generate
* `fonts` -- (optional) an array of objects with a `name` and `url`, linking to fonts in TTF or OTF format, which can then be referenced by name in the styling
* `sprites` -- (optional) an array of objects with a `name` and `path`, linking to images in SVG format, which can then be referenced by name in the styling
* `sources` -- an array of sources, described below
* `styling` -- follows the [Vector Tile Style specification](https://docs.mapbox.com/mapbox-gl-js/style-spec/), though with the `glyphs` and `sources` sections automatically generated, and so onlyneeds to include a `layers` section at a minimum, which should expect a source named `primary`

The styling can be generated with [Maputnik](https://maputnik.github.io/).

Inputs have this format:

* `name` -- A unique name for this input
* `url` -- (specify either this or `path`) For a file that should be downloaded from the web
* `path` -- (specify either this or `url`) For a file that exists somewhere on your computer
* `format` -- (optional) If the `path`/`url` doesn't end with an extension indicating the file format, give it here

Inputs are merged together to produce each output. If the file is determined to be a Zip file (either through the extension or specified with `format`) it will be decompressed. Any `pdf` or `txt` files are ignored. If there is only one file left(or the files left constitute a Shapefile) that gets passed through to the next stage. If there are multiple files left then you'll get an error.

Sources have this format:

* `name` -- A unique name for this source
* `system` -- A [Proj](https://proj.org/) string describing the spatial reference system (note [this FAQ item about axis ordering](https://proj.org/faq.html#why-is-the-axis-ordering-in-proj-not-consistent))
* `fieldLongitude` -- (optional) If the input is a CSV with longitude/latitude columns, give the column names here
* `fieldLatitude` -- (optional) If the input is a CSV with longitude/latitude columns, give the column names here
* `inputs` -- an array of inputs, described above
* `outputs` -- an array of outputs, described below

Outputs have this format:

* `name` -- A unique name for this output, which can then be referenced as a source layer in the styling
* `layer` -- (optional) The name of the layer from the input that this output should use, defaults to the first layer it finds
* `fields` -- (optional) An object listing fields you want in the output to the names of those fields in the input layer
* `zoomMin` -- (optional) The most zoomed-out level of tiles that should include this data
* `zoomMax` -- (optional) The most zoomed-in level of tiles that should include this data


Example
-------

Download the example tilefile:

    $ curl https://github.com/maxharlow/pantiler/raw/master/example.yaml > example.yaml

Run Pantiler, putting our tiles into a directory named `tiles`:

    $ npx pantiler example.yaml tiles

Download the example tile viewer:

    $ curl https://github.com/maxharlow/pantiler/raw/master/example.html > example.html

Serve the tiles and viewer locally:

    $ npx local-web-server --hostname localhost --port 8080

You should now be able to see a map at [localhost:8080/example.html](http://localhost:8080/example.html).
