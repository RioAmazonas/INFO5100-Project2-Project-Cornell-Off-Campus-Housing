$(function () {
  d3.json("cornell_housing_data.json", function(housingData) {
    d3.csv("WalkScore.csv", function(walkScoreData) {
      /* "update" is a function that can be called by any part of this closure
       * to signal that the overlay should update. Right now we have no overlay,
       * so this does nothing. The overlay should update this variable with the
       * appropriate function to be called to trigger an update. */
      var update = function() {};

      housingData.forEach(function(i) {
        if (i.bedrooms !== "studio") {
          //convert room counts to ints. Some room counts will look like "3+" -
          //this will just convert that to 3.
          i.bedrooms = parseInt(i.bedrooms);
        }
        i.rent_per_person = parseInt(i.rent_per_person);
        walk_score = _.find(walkScoreData, j => j.address === i.address);
        if (walk_score) {
          _.extend(i, walk_score);
          i.walk_score = parseInt(i.walk_score);
        }
        else {
          i.missing_walk_score = true;
        }
      });
      housingData = housingData.filter(i => i.missing_walk_score !== true);

      // room type selector
      var roomTypes = ["studio"].concat(
        _.chain(housingData).pluck("bedrooms").uniq().sort().without("studio").value()
      );

      var roomSelect = d3.select("#roomSelect");
      roomTypes.forEach(function(type) {
        roomSelect.append("option").attr("value", type).text(type);
      });

      // Define a function to create slider ranges
      function createSlider(node, input, min, max) {
        node.slider({
          range: true,
          min: min,
          max: max,
          values: [ min, max ],
          slide: function( event, ui ) {
            input.val(ui.values[0] + " - " + ui.values[1]);
            node.data("min", ui.values[0]);
            node.data("max", ui.values[1]);
            update();
          }
        });
        //attach a function to the slider node that will allow us to easily
        //set a new range
        node.data("setRange", function (min, max) {
          node.slider("option", {values: [min, max]});
          input.val(min + " - " + max);
          node.data("min", min);
          node.data("max", max);
        });
        //call the setRange function now to make sure everything is initialized
        node.data("setRange")(min, max);
      }


      var rentExtent= d3.extent(housingData, x => x.rent_per_person);

      var rentMin = Math.floor(rentExtent[0]);
      var rentMax = Math.ceil(rentExtent[1]);

      //set sliders. rent change is set by the roomSelect dropdown
      //change event.
      createSlider($("#walkscore-range"), $("#walkscore-range-input"), 0, 100);
      createSlider($("#rent-range"), $("#rent-range-input"), rentMin, rentMax);

      //set slider details
      $("#rent-range-min").text(rentMin);
      $("#rent-range-max").text(rentMax);

      //Whenever the roomSelect dropdown changes, update the rent slider
      $("#roomSelect").on("change", function() {
        var roomSelectVal = $("#roomSelect").val();

        if (roomSelectVal) {
          var housingDataForHouseType = housingData.filter(function(d){
            return d.bedrooms == roomSelectVal;
          })
        } else {
          housingDataForHouseType = housingData;
        }

        rentExtentForHouseType = d3.extent(housingDataForHouseType, x => x.rent_per_person);

        var rentMin = Math.floor(rentExtentForHouseType[0]);
        var rentMax = Math.ceil(rentExtentForHouseType[1]);

        //update the rent slider to match the new range
        $("#rent-range").data("setRange")(rentMin, rentMax);
        //update the overlay
        update();
      })
      //now that we've defined this handler, trigger it immediately to set the
      //min/max range on the rent slider
      .trigger("change");

      // Create the Google Map
      var initialLocation = new google.maps.LatLng(42.443417, -76.491842)
      var map = new google.maps.Map(d3.select("#map").node(), {
        zoom: 15,
        center: initialLocation,
        mapTypeId: google.maps.MapTypeId.ROADMAP
      });

      // Make map grayscale
      var grayscaleMap = [{ stylers: [{ saturation: -100 }] }];
      map.setOptions({styles: grayscaleMap});

      var overlay = new google.maps.OverlayView();

      // Add the container when the overlay is added to the map.
      overlay.onAdd = function() {
        var layer = d3.select(this.getPanes().overlayMouseTarget).append("div")
            .attr("class", "housings");
        var self = this;

        // Draw each marker as a separate SVG element.
        overlay.draw = function() {
          var filteredData = housingData.filter(function (x) {
            var ret = true;
            var roomSelectVal = $("#roomSelect").val()
            if (roomSelectVal) {
              ret = ret && x.bedrooms == roomSelectVal;
            }
            var rentRangeMin = $("#rent-range").data("min");
            var rentRangeMax = $("#rent-range").data("max");
            ret = ret && (x.rent_per_person >= rentRangeMin && x.rent_per_person <= rentRangeMax);
            var walkScoreMin = $("#walkscore-range").data("min");
            var walkScoreMax = $("#walkscore-range").data("max");
            ret = ret && (x.walk_score >= walkScoreMin && x.walk_score <= walkScoreMax);
            return ret;
          })

          var projection = self.getProjection(),
              padding = 10;

          //remove old markers if there were any.
          layer.selectAll("svg").remove();

          // Opacity scale: low (low walk_score) <-> high (high walk_score)
          var opacityScale = d3.scale.linear().domain([0,100]).range([0.2,1]);

          // Color scale: red (high rent_per_person) <-> green (low rent_per_person)
          var colorScale = d3.scale.linear().domain([100,900,1800]).range(["green","yellow","red"]);

          // Add a circle to the map for each data entry
          var markers = layer.selectAll("svg")
              .data(d3.entries(filteredData))
              .enter().append("svg")
              .each(transform)
              .append("circle")
              .attr("r", 4.5)
              .attr("cx", padding)
              .attr("cy", padding)
              .attr("stroke", "black")
              .attr("fill", function(d) { return colorScale(d.value.rent_per_person); })
              .style("fill-opacity", function(d) { return opacityScale(d.value.walk_score); })
              .each(function(x) {
                var infowindow;
                // open infowindow
                google.maps.event.addDomListener(this, "mouseover", function(e) {
                  e.cancelBubble = true;
                  if (e.stopPropagation) {
                    e.stopPropagation()
                  }
                  var contentString =
                  "<div class=info-window>" +
                  "<h3>" + x.value.address + "</h3>" +
                  "<p>" +
                  "# of Bedrooms: &nbsp;" + x.value.bedrooms + "<br>" +
                  "Rent/Person: &nbsp;" + "<b>" + "$" + x.value.rent_per_person + "</b>" + "<br>" +
                  "Walk Score: &nbsp;" + "<b>" + x.value.walk_score + "</b>" + "<br>" +
                  "Neighborhood: &nbsp;" + x.value.neigborhood + "<br>" +
                  "Distance to Cornell: &nbsp;" + x.value.distance + "<br>" +
                  "Date Available: &nbsp;" + x.value.date_available + "<br>" +
                  "Lease Length: &nbsp;" + x.value.lease_length +
                  "</p>" +
                  "</div>";

                  infowindow = new google.maps.InfoWindow({
                   content: contentString,
                   position: new google.maps.LatLng(x.value.lat, x.value.lon)
                  });
                  infowindow.open(map);
                });
                // close infowindow
                google.maps.event.addDomListener(this, "mouseout", function(e) {
                  infowindow.close(map);
                });
              });

          function transform(d) {
            d = new google.maps.LatLng(d.value.lat, d.value.lon);
            d = projection.fromLatLngToDivPixel(d);

            return d3.select(this)
                .style("left", (d.x - padding) + "px")
                .style("top", (d.y - padding) + "px");
          }
        };
        update = overlay.draw;
      };
      // Bind our overlay to the map
      overlay.setMap(map);
    });
  });
});
