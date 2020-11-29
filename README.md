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

* `directory` Where the tiles will be created, should not already exist.
* `cache` The name of a directory where files will be cached. Optional. Default is `.pantiler-cache`.
* `clearCache` Whether the cache should be removed after running. Optional. Default is false.
* `alert` A function that will be called with informational messages as Pantiler runs. Optional. Default does nothing.

Then run it:

    await pantiler(tiledata)

Where `tiledata` is an object following the tilefile format, described below.


Tilefiles
---------

Tilefiles are written in Yaml or Json. There is an `example.yaml` included for reference.

* `host` The location the tiles will be served from.
* `zoomFrom` The most zoomed-out level of tiles to generate.
* `zoomTo` The most zoomed-in level of tiles to generate.
* `fonts` An array of *inputs* specifying fonts in TTF or OTF format, which can then be referenced by name in the styling. Optional.
* `sprites` An array of *inputs* specifying images in SVG format, which can then be referenced by name in the styling. Optional.
* `sources` An array of *sources*.
* `styling` Follows the [Vector Tile Style specification](https://docs.mapbox.com/mapbox-gl-js/style-spec/), though with the `glyphs` and `sources` sections automatically generated, and so only needs to include a `layers` section at a minimum, which should expect a source named `primary`. This can be generated with [Maputnik](https://maputnik.github.io/).

Inputs have this format:

* `name` A unique name for this input.
* `url` Specify either this or `path`. For a file that should be downloaded from the web.
* `path` Specify either this or `url`. For a file that exists somewhere on your computer.
* `format` If the `path`/`url` doesn't end with an extension indicating the file format, specify it here. Optional.

Inputs are merged together to produce each output. If the file is determined to be a Zip file (either through the extension or specified with `format`) it will be decompressed. Any `pdf` or `txt` files are ignored. If there is only one file left(or the files left constitute a Shapefile) that gets passed through to the next stage. If there are multiple files left then you'll get an error.

Sources have this format:

* `name` A unique name for this source.
* `system` A [Proj](https://proj.org/) string describing the spatial reference system (note [this FAQ item about axis ordering](https://proj.org/faq.html#why-is-the-axis-ordering-in-proj-not-consistent)).
* `fieldLongitude` For CSV inputs with separate coordinates, specify the longitude column name. Optional.
* `fieldLatitude` For CSV inputs with separate coordinates, specify the latitude column name. Optional.
* `inputs` An array of *inputs* specifying geographical data.
* `outputs` An array of *outputs*.

Outputs have this format:

* `name` A unique name for this output, which can then be referenced as a source layer in the styling.
* `layer` The name of the input layer that this output should use. Optional. Default is the first layer it finds.
* `fields` An object listing fields you want in the output to the names of those fields in the input layer. Optional.
* `zoomMin` The most zoomed-out level of tiles that should include this data. Optional.
* `zoomMax` The most zoomed-in level of tiles that should include this data. Optional.


Example
-------

Download the example tilefile:

    $ curl -L https://github.com/maxharlow/pantiler/raw/master/example.yaml > example.yaml

Run Pantiler, putting the output into a directory named `tiles`:

    $ npx pantiler example.yaml tiles

Download the example tile viewer:

    $ curl -L https://github.com/maxharlow/pantiler/raw/master/example.html > example.html

Serve the tiles and viewer locally:

    $ npx local-web-server --hostname localhost --port 8080

You should now be able to see a map at [localhost:8080/example.html](http://localhost:8080/example.html).
