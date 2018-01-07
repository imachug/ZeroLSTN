version = "0.1"

// JS Animations
var anime = require("animejs");
window.anime = anime;

// Material CSS
var Materialize = require("materialize-css/dist/js/materialize.min.js");

var ZeroFrame = require("./libs/ZeroFrame.js");
var Router = require("./libs/router.js");
var Vue = require("vue/dist/vue.js");
var VueZeroFrameRouter = require("./libs/vue-zeroframe-router.js");

// Data types
var Deque = require("double-ended-queue");

var { sanitizeStringForUrl, sanitizeStringForUrl_SQL, html_substr, sanitizeHtmlForDb } = require("./util.js");

// Initial Vue plugins
Vue.use(VueZeroFrameRouter.VueZeroFrameRouter);

// Vue components
var NavBar = require("./vue_components/navbar.vue");
var FooterBar = require("./vue_components/footer_bar.vue");

var app = new Vue({
	components: {
		navbar: NavBar,					// Navbar - Vue component
		footerBar: FooterBar			// Footer - Vue component
	},
	el: "#app",
	template: `<div>
			<navbar ref="navbar" :user-info="userInfo"></navbar>
			<component ref="view" :is="currentView" :play-queue="playQueue" :merger-zites="mergerZites"></component>
			<footerBar ref="footerBar"></footerBar>
		</div>`,
	data: {
		currentView: null,				// Current View - Vue component (dynamic)
		userInfo: null,					// ZeroFrame userInfo object
		siteInfo: null,					// ZeroFrame siteInfo object
		mergerZites: null,				// List of all merger Zites (genres) we know of
		playQueue: new Deque(),			// Play Queue itself
		queueIndex: 0,					// Current index in the play queue of song we're playing
		audioVolume: 80,				// Current audio volume
		audioObject: null 				// Object housing JS audio object (play, pause, etc)
	},
	methods: {
		getUserInfo: function(f = null) {
            if (this.siteInfo == null || this.siteInfo.cert_user_id == null) {
                this.userInfo = null;
                return;
            }

			// Keep a reference to our own state
            var that = this;

            that.userInfo = {
                cert_user_id: that.siteInfo.cert_user_id,
                auth_address: that.siteInfo.auth_address
            };
            that.$emit("setUserInfo", that.userInfo);
            if (f !== null && typeof f === "function") f();
		}
	}
});

class ZeroApp extends ZeroFrame {
	onOpenWebsocket() {
		var self = this;

		// Check if user is logged in on pageload
		this.cmdp("siteInfo", {})
			.then(siteInfo => {
				self.siteInfo = siteInfo;
				app.siteInfo = siteInfo;
				app.getUserInfo();

			// Add initial merger sites/genres
			page.requestPermission("Merger:ZeroLSTN", siteInfo, function() {
				page.cmdp("mergerSiteList", [true])
					.then((mergerZites) => {
						console.log("Got Merger Zites");
						if (!mergerZites["1JErkEXytYwAb8xvwKVKfbNmP2EZxPewbE"]) {
							page.addMerger("1JErkEXytYwAb8xvwKVKfbNmP2EZxPewbE")
								.then(() => {
									return self.cmdp("wrapperNotification", ["info", "You may need to refresh to see new music."]);
								});
						} else {
							app.mergerZites = mergerZites;
							app.$emit('setMergerZites', mergerZites);
						}
					});
			});
		});
	}

	// Request permission to the ZeroLSTN merger/access ZeroLSTN site data
	requestPermission(permission, siteInfo, callback) {
		// Already have permission
		if (siteInfo.settings.permissions.indexOf(permission) > -1) {
			callback();
			return;
		}

		this.cmdp("wrapperPermissionAdd", [permission])
			.then(callback);
	}

	// Adds a new merger site
	addMerger(ziteAddress) {
		var self = this;

		return this.cmdp("mergerSiteAdd", [ziteAddress])
			.then(() => {
				return self.cmdp("mergerSiteList", [true])
					.then((mergerZites) => {
						app.mergerZites = mergerZites;
						app.$emit('setMergerZites', mergerZites);
						return mergerZites;
						//self.cmdp("wrapperOpenWindow", [self.siteInfo.address]);
					});
			});
	}

	// Needed for ZeroRouter to work properly
	onRequest(cmd, message) {
		Router.listenForBack(cmd, message);
		if (cmd === "setSiteInfo") {
			this.siteInfo = message.params;
			app.siteInfo = message.params;
			app.getUserInfo();
		}

		if (message.params.event[0] === "file_done") {
			app.$emit("update");
		}
	}

	selectUser() {
		return this.cmdp("certSelect", { accepted_domains: ["zeroid.bit", "kaffie.bit", "cryptoid.bit", "peak.id"] });
    }

    signout() {
    	return this.cmdp("certSelect", { accepted_domains: [""] });
    }

    unimplemented() {
        return page.cmdp("wrapperNotification", ["info", "Unimplemented!"]);
	}

	// -------------------------------------------------- //
	// ---------- Uploading and Editing Songs ----------- //

	checkOptional(genreAddress, doSignPublish, f) {
		// Make sure user is logged in first
        if (!app.userInfo || !app.userInfo.cert_user_id) {
            this.cmd("wrapperNotification", ["info", "Please login first."]);
            return;
        }

		// Get the user's data.json filepath
        var data_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + this.siteInfo.auth_address + "/data.json";
        var content_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + this.siteInfo.auth_address + "/content.json";

        // Verify that user has correct "optional" and "ignore" values
        page.cmd("fileGet", { "inner_path": content_inner_path, "required": false }, (data) => {
            if (!data) {
				console.log("Creating default data.json...");
				data = {};
			} else {
				data = JSON.parse(data);
			}

			// Allowed filetypes
            var curoptional = ".+\\.(mp3|flac|ogg|mp4|webm)";
            var changed = false;
            if (!data.hasOwnProperty("optional") || data.optional !== curoptional){
                data.optional = curoptional
                changed = true;
            }

            var json_raw = unescape(encodeURIComponent(JSON.stringify(data, undefined, "\t")));

            if (changed) {
                // Write (and Sign and Publish is doSignPublish)
                page.cmd("fileWrite", [content_inner_path, btoa(json_raw)], (res) => {
                    if (res === "ok") {
                        if (f != null && typeof f === "function") f();
                        if (doSignPublish) {
                            page.cmd("siteSign", { "inner_path": content_inner_path }, () => {
                                page.cmd("sitePublish", { "inner_path": content_inner_path, "sign": false });
                            });
                        }
                    } else {
                        page.cmd("wrapperNotification", ["error", "File write error: " + JSON.stringify(res)]);
                    }
                });
            } else {
                if (f != null && typeof f === "function") f();
            }
        });
	}
	
	// Uploads a file using the BigFile API. Returns new filename.
	uploadBigFile(genreAddress, file, f = null) {
		console.log("Got it!");
        var date_added = Date.now();
        var orig_filename_list = file.name.split(".");
        var filename = orig_filename_list[0].replace(/\s/g, "_").replace(/[^\x00-\x7F]/g, "").replace(/\'/g, "").replace(/\"/g, "") + "-" + date_added + "." + orig_filename_list[orig_filename_list.length - 1];

		var f_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + app.siteInfo.auth_address + "/" + filename;
		console.log(f_path);

        page.checkOptional(genreAddress, false, () => {
            page.cmd("bigfileUploadInit", [f_path, file.size], (init_res) => {
                var formdata = new FormData();
                formdata.append(file.name, file);

                var req = new XMLHttpRequest();

                req.upload.addEventListener("progress", console.log);
                req.upload.addEventListener("loadend", () => {
                    page.cmd("wrapperNotification", ["info", "File saved. Click Save to publish!"]);
                    if (f !== null && typeof f === "function") f(filename);
                });
                req.withCredentials = true;
                req.open("POST", init_res.url);
                req.send(formdata);
            });
        });
	}

	// Add new song info to user's data.json. Returns new song ID.
	uploadSong(genreAddress, filename, title, album, artist, f = null) {
		// Check user is logged in (assume they are, but just in case...)
		if (!app.siteInfo.cert_user_id) {
    		return this.cmdp("wrapperNotification", ["error", "You must be logged in to post a song."]);
		}
		
		// Get the user's data.json filepath
        var data_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + app.siteInfo.auth_address + "/data.json";
        var content_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + app.siteInfo.auth_address + "/content.json";

		var self = this;
		var date = Date.now();
    	return this.cmdp("fileGet", { "inner_path": data_inner_path, "required": false })
    		.then((data) => {
				// Get user's existing data
    			data = JSON.parse(data);
    			if (!data) { // If no existing data, make some
    				data = {};
    			}

				// If no songs uploaded yet, create empty array
    			if (!data["songs"]) data["songs"] = [];

				// Add new song with default data
    			data["songs"].push({
					"id": '' + date, // Convert ID to string
					"filename": filename,
					"title": title,
					"album": album,
					"artist": artist,
					"uploader": app.siteInfo.auth_address,
    				"date_added": date
    			});

				// Write values back to JSON string and the data.json
    			var json_raw = unescape(encodeURIComponent(JSON.stringify(data, undefined, '\t')));

				return self.cmdp("fileWrite", [data_inner_path, btoa(json_raw)]);
				
				// Sign and publish site
    		}).then((res) => {
    			if (res === "ok") {
    				return self.cmdp("siteSign", { "inner_path": content_inner_path });
    			} else {
    				return self.cmdp("wrapperNotification", ["error", "Failed to write to data file."]);
    			}
    		}).then((res) => {
				// Run callback function
				if (f !== null && typeof f === "function") f(date);
		});
	}

	// Edit existing song stored in user's data.json. Returns songID.
	editSong(genreAddress, songID, title, album, artist, f = null) {
		// Check user is logged in (assume they are, but just in case...)
		if (!app.siteInfo.cert_user_id) {
    		return this.cmdp("wrapperNotification", ["error", "You must be logged in to post a song."]);
		}
		
		// Get the user's data.json filepath
        var data_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + app.siteInfo.auth_address + "/data.json";
        var content_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + app.siteInfo.auth_address + "/content.json";

		var self = this;
    	return this.cmdp("fileGet", { "inner_path": data_inner_path, "required": false })
    		.then((data) => {
				// Get user's existing data
    			if (!data) {
					// Can't edit a song if there aren't any yet
					console.log("ERROR");
					return;
				} else {
					// Parse user's data into JS object
					data = JSON.parse(data);
				}
	
				// Can't edit a song if there aren't any yet
				if (!data["songs"]) {
					console.log("ERROR");
					return;
				}

				// Find and edit song with given ID
				var songToEdit = null;
				for (var song of data["songs"]) {
					if (song.id === songID) {
						songToEdit = song
						break;
					}
				}

				if(!songToEdit) {
					console.log("Unable to find song. Given ID: " + songID + ", list:");
					console.log(data["songs"]);
					return;
				}

				// Update with new values
				songToEdit.title = title;
				songToEdit.album = album;
				songToEdit.artist = artist;

				// Write values back to JSON string and the data.json
    			var json_raw = unescape(encodeURIComponent(JSON.stringify(data, undefined, '\t')));

				return self.cmdp("fileWrite", [data_inner_path, btoa(json_raw)]);
				
				// Sign and publish site
    		}).then((res) => {
    			if (res === "ok") {
    				return self.cmdp("siteSign", { "inner_path": content_inner_path });
    			} else {
    				return self.cmdp("wrapperNotification", ["error", "Failed to write to data file."]);
    			}
    		}).then((res) => {
    			if (res === "ok") {
    				return self.cmdp("sitePublish", { "inner_path": content_inner_path, "sign": false });
    			} else {
    				return self.cmdp("wrapperNotification", ["error", "Failed to sign user data."]);
				}
			}).then((res) => {
				// Run callback function
				if (f !== null && typeof f === "function") f(songID);
			});
	}

	// Get song info from ID. Returns song object.
	retrieveSongInfo(genreAddress, songID, authAddress, f = null) {	
		// Get the user's data.json filepath
        var data_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + authAddress + "/data.json";
		var content_inner_path = "merged-ZeroLSTN/" + genreAddress + "/data/users/" + authAddress + "/content.json";
		
    	return this.cmdp("fileGet", { "inner_path": data_inner_path, "required": false })
    		.then((data) => {
				// Get user's existing data
    			if (!data) {
					// Can't edit a song if there aren't any yet
					console.log("ERROR");
					return;
				} else {
					// Parse user's data into JS object
					data = JSON.parse(data);
				}
	
				// Can't edit a song if there aren't any yet
				if (!data["songs"]) {
					console.log("ERROR");
					return;
				}

				// Find and edit song with given ID
				var songToRetrieve = null;
				for (var song of data["songs"]) {
					if (song.id === songID) {
						songToRetrieve = song
						break;
					}
				}

				console.log("Got song:");
				console.log(songToRetrieve);

				// Run callback function
				if (f !== null && typeof f === "function") f(songToRetrieve);
		});
	}

	// Get all songs a user has uploaded as an array
	getSongsByUser(userAuthAddress) {
		var query = `
		SELECT * FROM songs
			LEFT JOIN json USING (json_id)
			WHERE uploader='${userAuthAddress}'
			ORDER BY date_added ASC
		`;
	
		return this.cmdp("dbQuery", [query]);
	}

	// TODO: Return a list of all songs, with an optional max song amount and offset
	getAllSongs(limit = 0, offset = 0) {

	}

	// Returns an array of all known artist names
	getKnownArtists() {
		var query = `
		SELECT DISTINCT artist FROM songs
			LEFT JOIN json USING (json_id)
			ORDER BY date_added ASC
		`;
	
		return this.cmdp("dbQuery", [query])
			.then((artistObjs) => {
				// Unpack "artist" string attribute into its own array of strings
				return new Promise((resolve, reject) => {
					resolve(artistObjs.map(function(a) {return a.artist;}));
				});
			});
	}

	// Returns an array of album titles, made by the given artist
	getAlbumsByArtist(artistName) {
		var query = `
		SELECT DISTINCT album FROM songs
			LEFT JOIN json USING (json_id)
			WHERE artist='${artistName}'
			ORDER BY date_added ASC
		`;
	
		return this.cmdp("dbQuery", [query])
			.then((albumObjs) => {
				// Unpack "albums" string attribute into its own array of strings
				return new Promise((resolve, reject) => {
					resolve(albumObjs.map(function(a) {return a.album;}));
				});
			});
	}

	// Return an array of objects with album titles and songs in the form of
	// {"title": [song1, song2...]}
	getAlbumsWithSongsByArtist(artistName) {
		var query = `
		SELECT * FROM songs
			LEFT JOIN json USING (json_id)
			WHERE artist='${artistName}'
			ORDER BY date_added ASC
		`;
	
		return this.cmdp("dbQuery", [query])
			.then((songObjs) => {
				// Unpack "albums" string attribute into its own array of strings
				console.log(songObjs);
				return new Promise((resolve, reject) => {
					var albums = {};

					// Iterate over songObjs
					songObjs.forEach(function(song) {
						// Check to see if we've seen this album yet
						var albumTitle = song.album;
						if (!albums.hasOwnProperty(albumTitle)) {
							// If not, create a new array for its song to live in
							console.log("Creating new album: " + song.album)
							albums[albumTitle] = [];
						}

						// Add the song to this album's array
						albums[albumTitle].push(song);
					});
					// Create a new promise to return to whoever called getAlbumsWithSongsByArtist
					resolve(albums);
				});
			});
	}

	// Returns all songs in a given album
	getSongsInAlbum(albumName) {
		var query = `
		SELECT * FROM songs
			LEFT JOIN json USING (json_id)
			WHERE album='${albumName}'
			ORDER BY date_added ASC
		`;
	
		return this.cmdp("dbQuery", [query]);
	}

	// -------------------------------------------------- //
	// ------------- Play Queue Operations -------------- //

	// Play a music file
	playSongFile(filepath) {
		// If audioObject already exists, change its source
		if(app.audioObject) {
			app.audioObject.src = filepath;
			app.audioObject.load();
		} else { // Otherwise make a new audio object
			app.audioObject = new Audio(filepath);
		}

		// Set the audio source's volume
		app.audioObject.volume = app.audioVolume / 100;
		app.audioObject.play();

		// Tell Vue objects that the current song is being played
		app.$emit("songPlaying", true);
	}

	// Play a given song object
	playSong(song) {
		var filepath = "merged-ZeroLSTN/" + song.site + "/" + song.directory + "/" + song.filename;

		// Play the song
		this.playSongFile(filepath);

		// Update footer with new song duration once metadata has been loaded
		app.audioObject.addEventListener('loadedmetadata', function() {
			console.log("Updating with duration: " + app.audioObject.duration);
			app.$emit("updateSongDuration", app.audioObject.duration);
		});

		// Add event listener for when song finishes, so we can either move to the next song,
		// or stop the playback if it's the last song in the queue
		var self = this;
		app.audioObject.addEventListener('ended', function() {
			self.songEnded();
		});
	}

	// Called when the current song ends
	songEnded() {
		console.log("Song ended. Current index: " + app.queueIndex);
		// Check if this is the same song in the queue
		if (app.queueIndex == app.playQueue.length - 1){
			// Tell Vue components song has stopped playing
			app.$emit("songPlaying", false);
			return;
		}

		// Otherwise move on to the next song in the queue
		this.nextSong();
	}

	// Place a song at end of play queue and skip to it.
	playSongImmediately(song) {
		// Add song to the queue
		app.playQueue.insertBack(song);

		// Set index to end of queue
		app.queueIndex = app.playQueue.length - 1;

		// Update Vue components that queue index changed
		app.$emit("updatePlayQueueIndex", app.queueIndex);

		this.playSongAtQueueIndex(app.queueIndex);
	}

	// Add a song to the end of the play queue
	queueSong(song) {
		console.log("Queueing " + song.title + " by " + song.artist);
		app.playQueue.insertBack(song);

		// Make sure our queueIndex exists
		// Update Vue components that play queue changed
		console.log("Emitting update!")
		console.log("Mainapp's queue:")
		console.log(app.playQueue.toArray());
		console.log("Current queue index: " + app.queueIndex);
		app.$emit("updatePlayQueue", app.playQueue);
	}

	// Return the queue contents as an array of songs
	getPlayQueue() {
		return app.playQueue.toArray();
	}

	// Return the current queue index
	getQueueIndex() {
		return app.queueIndex;
	}

	// Return the current audio object
	getAudioObject() {
		return app.audioObject;
	}

	// Play a song at an index in the current queue
	playSongAtQueueIndex(index) {
		this.playSong(app.playQueue.get(index));
	}

	// Play the current running audio
	playCurrentSong() {
		// If there isn't any audio available yet, play first song in queue
		console.log("Playing current song")
		if (!app.audioObject) {
			if(app.playQueue && app.playQueue.length > 0) {
				this.playSongAtQueueIndex(0);
			} else {
				// If we've got no queue, don't play anything
				return;
			}
		} else {
			app.audioObject.play();
		}

		// Tell Vue objects that the current song is being played
		app.$emit("songPlaying", true);
	}

	// Pause the current running audio
	pauseCurrentSong() {
		// If there isn't any audio available yet, do nothing
		if (!app.audioObject) {
			console.log("Necessary? pause");
			return;
		}
		app.audioObject.pause();

		// Tell Vue objects that the current song has been paused
		app.$emit("songPlaying", false);
	}

	stopPlaying() {
		console.log("Stopping playback.");
		// Stop playing all songs
		app.audioObject.currentTime = 0;
		app.audioObject.pause();

		// Set the queueIndex to the beginning
		app.queueIndex = 0;

		// Update Vue components that queue index changed
		app.$emit("updatePlayQueueIndex", app.queueIndex);

		// Tell Vue objects that the current song has been paused
		app.$emit("songPlaying", false);

		// Update footer with no song duration
		app.$emit("updateSongDuration", 0);
	}

	// Skip to the next song
	nextSong() {
		console.log("Going to next song. Index: " + app.queueIndex);

		// Move the index forward
		app.queueIndex++;
		if(app.queueIndex >= app.playQueue.length) {
			// We've reached the end of the queue, stop playing
			this.stopPlaying();
			return;
		}

		// Update Vue components that queue index changed
		app.$emit("updatePlayQueueIndex", app.queueIndex);

		// Play whatever song is at that index
		this.playSongAtQueueIndex(app.queueIndex);
	}

	// Go back to the previous song
	prevSong() {
		// Check if queue exists, if not create it
		if (!app.playQueue) {
			app.playQueue = new Deque();
		}

		// Move the index back
		app.queueIndex--;
		if(app.queueIndex < 0) {
			app.queueIndex = 0;
		}

		// Update Vue components that queue index changed
		//app.$emit("updatePlayQueueIndex", app.queueIndex);

		// Play whatever song is at that index
		this.playSongAtQueueIndex(app.queueIndex);
	}

	// Set the current audio volume
	setVolume(volume) {
		app.audioVolume = volume;

		// It's alright if we don't have an audio object yet, it'll
		// get the new volume when it's initialized
		if(app.audioObject){
			// If we do have one already, set its volume
			app.audioObject.volume = volume / 100;
		}
	}

	// Sets the current track time
	setTime(time) {
		app.audioObject.currentTime = time;
	}

	// -------------------------------------------------- //
}

page = new ZeroApp();

var Uploads = require("./router_pages/uploads.vue");
var Edit = require("./router_pages/edit.vue");
var PlayQueue = require("./router_pages/playqueue.vue");
var Home = require("./router_pages/home.vue");

VueZeroFrameRouter.VueZeroFrameRouter_Init(Router, app, [
	{ route: "uploads", component: Uploads },
	{ route: "edit/:genre/:songID", component: Edit },
	{ route: "playqueue", component: PlayQueue },
	{ route: "", component: Home }
]);